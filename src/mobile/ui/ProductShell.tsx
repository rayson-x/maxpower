import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  Platform,
} from "react-native";
import Svg, { Circle } from "react-native-svg";

import type { CoachApplication } from "../../coach";
import type { DynamicFormAnswer, DynamicFormCard, FirstPlannerHandoffProposal, OnboardingEntryState } from "../../onboarding";
import type { NutritionStrategyData } from "../../coach/domain";
import type { CoachContextKind, CoachMessage, CoachSession, ContextRef, EvidenceBriefArtifact, NutritionObservationDraftArtifact } from "../../coach/model";
import type { CustomExerciseVariantView, MovementPattern } from "../../knowledge";
import {
  CoachDrawer,
  CoachStreamProjection,
  type CoachStreamSnapshot,
} from "../../coach/ui";
import {
  coachDrawerAvailableForRoute,
  type CoachDrawerRoute,
  type CalendarPresentationMode,
  type CoachProductProjection,
  type ProductSession,
  type WorkoutOutcomeProductSummary,
  presentReplicaSyncOverview,
} from "../../product";
import type { TimelineReadEvent } from "../../timeline";
import type { CloudMediaLibrary } from "../cloud";
import {
  createManualMealObservation,
  estimateMaintenanceEnergy,
  type DailyIntakeBudget,
  type DailyIntakeStatus,
  type NextMealRecommendation,
} from "../../nutrition";
import { colors, radius } from "./theme";
import {
  APP_DOCK_BODY_HEIGHT,
  BottomDrawer,
  CalendarPager,
  type CoachComposerAnchor,
  HorizontalRoutePager,
  type HorizontalRoutePagerHandle,
  PanelCard,
  SectionHeading,
  SegmentedControl,
  TrendChart,
  uiColors,
} from "../ui-kit";
import { ANDROID_HEALTH_CONNECT_MVP_METRICS } from "../native/AndroidHealthConnectPort";
import { APPLE_HEALTHKIT_MVP_METRICS } from "../native/AppleHealthKitPort";
import { ProgressScreen as VideoLibraryScreen, type ReplaySelection } from "./ProgressScreen";
import { ReplayScreen } from "./ReplayScreen";
import { WorkoutMonitorWorkspace } from "./WorkoutMonitorWorkspace";
import type { WorkoutSetRealtimeContext } from "./workoutRealtime";
import { resolveWorkoutSetRealtimeCapability } from "./workoutRealtime";
import { NutritionObservationDraftSheet } from "./NutritionObservationDraftSheet";
import { TimelineCorrectionSheet } from "./TimelineCorrectionSheet";
import { WorkoutOutcomeCorrectionSheet } from "./WorkoutOutcomeCorrectionSheet";
import { RecordFocus, type RecordFocusMode } from "./RecordFocus";
import { BaselineIntakeCard } from "./BaselineIntakeCard";
import { EMPTY_BASELINE_INTAKE, type BaselineIntakeValues } from "./baselineIntake";
import { DynamicOnboardingFormCard } from "./DynamicOnboardingFormCard";
import {
  createDynamicOnboardingFormValues,
  updateDynamicOnboardingFormValue,
  type DynamicOnboardingFormValue,
  type DynamicOnboardingFormValues,
} from "./dynamicOnboardingForm";
import { ProductDock } from "./components/ProductDock";
import { Timeline } from "./components/Timeline";
import {
  buildPlanningReportSummary,
  forecastEligibility,
  forecastName,
  planningPhrase,
  strategyName,
} from "./planningReport";
import type { ProductShellStateStore } from "./ProductShellStateStore";
import {
  createCloudPlanRecoverySnapshot,
  createCloudProfileRecoverySnapshot,
  type ConfirmedProductBridge,
} from "../product-data";
import {
  applyInboundNavigationIntent,
  initialProductShellState,
  resolveUserDossierEntryRoute,
  resolveMaxPowerDeepLink,
  type ProductDeepLinkRoute,
  type ProductCoachAttachment,
  type ProductShellRecovery,
  type ProductShellState,
} from "./productNavigation";

export type ProductRoute = CoachDrawerRoute;
type PrimaryProductRoute = "today" | "calendar" | "plan" | "profile";

export interface ProductShellProps {
  application: CoachApplication;
  /** Confirmation boundary; MVP commits to the local account Ledger. */
  confirmedProduct: ConfirmedProductBridge;
  /** Explicit opt-in upload/list/delete workflow for personal media. */
  cloudMediaLibrary: CloudMediaLibrary;
  userId: string;
  /** Any validated notification or OS Linking event uses the same registry. */
  incomingDeepLink?: string;
  /** @deprecated Use incomingDeepLink for notification and OS URL events. */
  notificationDeepLink?: string;
  /** Local presentation-state port; domain facts remain in CoachApplication. */
  productShellStateStore?: ProductShellStateStore;
  /** Resolved before rendering by the native composition root. */
  initialProductShellRecovery?: ProductShellRecovery;
  onOpenAccountSettings?: () => void;
  /** Account runtime finishes a queued Timeline assessment after local writes. */
  onTimelineChanged?(): Promise<void>;
}

type ActivityLogMode = RecordFocusMode;
const DASHBOARD_CARD_MIN_HEIGHT = 456;

/** Shared iOS/Android shell. It owns navigation presentation state only. */
export function ProductShell({ application, confirmedProduct, cloudMediaLibrary, userId, incomingDeepLink, notificationDeepLink, productShellStateStore, initialProductShellRecovery, onOpenAccountSettings, onTimelineChanged }: ProductShellProps) {
  const initialShellState = initialProductShellRecovery?.state ?? initialProductShellState(localDate());
  const [route, setRoute] = useState<ProductRoute>(initialShellState.navigation.route);
  const [date, setDate] = useState(initialShellState.navigation.date);
  // A selected day is a factual-history target.  The calendar viewport is a
  // separate browsing concern: moving from August to July must not silently
  // turn 2026-08-19 into a different selected fact, 2026-07-19.
  const [calendarAnchorDate, setCalendarAnchorDate] = useState(initialShellState.navigation.date);
  const [calendarMode, setCalendarMode] = useState<CalendarPresentationMode>(initialShellState.navigation.calendarMode);
  const [workoutId, setWorkoutId] = useState<string | undefined>(initialShellState.navigation.workoutId);
  const [replaySelection, setReplaySelection] = useState<ReplaySelection>();
  const [replayReturnRoute, setReplayReturnRoute] = useState<"video_library" | "workout">("video_library");
  const [coachExpanded, setCoachExpanded] = useState(initialShellState.navigation.coachExpanded);
  const [coachComposerAnchor, setCoachComposerAnchor] = useState<CoachComposerAnchor>();
  const [recordAnchor, setRecordAnchor] = useState<CoachComposerAnchor>();
  const [coachFocusRequest, setCoachFocusRequest] = useState(0);
  const [coachEntryMode, setCoachEntryMode] = useState<"text" | "voice">("text");
  const [showActivityLog, setShowActivityLog] = useState(false);
  const [activityLogInitialMode, setActivityLogInitialMode] = useState<ActivityLogMode>("training");
  const [timelineCorrection, setTimelineCorrection] = useState<TimelineReadEvent>();
  const [workoutSummary, setWorkoutSummary] = useState<WorkoutOutcomeProductSummary>();
  const [workoutCorrectionId, setWorkoutCorrectionId] = useState<string>();
  const [nutritionDraft, setNutritionDraft] = useState<NutritionObservationDraftArtifact>();
  const [nutritionDraftBusy, setNutritionDraftBusy] = useState(false);
  const [screen, setScreen] = useState<CoachProductProjection>();
  const [onboardingEntry, setOnboardingEntry] = useState<OnboardingEntryState>();
  const [entryGate, setEntryGate] = useState<"resolving" | "resolved" | "failed">("resolving");
  const onboardingRequired = useRef(true);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const cloudConfirmed = confirmedProduct;
  const stream = useRef(new CoachStreamProjection());
  const [streamSnapshot, setStreamSnapshot] = useState<CoachStreamSnapshot>(stream.current.snapshot());
  const [coachSession, setCoachSession] = useState<CoachSession>();
  const [coachMessages, setCoachMessages] = useState<readonly CoachMessage[]>([]);
  const [coachSessions, setCoachSessions] = useState<readonly CoachSession[]>([]);
  const [coachAttachment, setCoachAttachment] = useState<ProductCoachAttachment | undefined>(initialShellState.coachAttachment);
  const initialShellRecoveryHandled = useRef(false);
  const productShellSaveChain = useRef(Promise.resolve());
  const primaryPager = useRef<HorizontalRoutePagerHandle>(null);
  const [shellRestorationReady, setShellRestorationReady] = useState(!initialProductShellRecovery);
  const navigationState = useRef({
    route: "today" as ProductDeepLinkRoute,
    date,
    calendarMode,
    coachExpanded,
    workoutId,
  });
  navigationState.current = {
    route: isProductDeepLinkRoute(route) ? route : "today",
    date,
    calendarMode,
    coachExpanded,
    workoutId,
  };

  const refresh = useCallback(async () => {
    setEntryGate("resolving");
    setLoading(true);
    try {
      const [projection, onboardingEntry] = await Promise.all([
        application.readProductProjection({
          userId,
          date,
          timezoneOffsetMinutes: new Date().getTimezoneOffset() * -1,
          calendarMode,
          calendarAnchorDate,
        }),
        application.readOnboardingEntryState({ userId }),
      ]);
      // A completed User dossier is the entry condition for the main product,
      // not merely a card the user may choose to open later. The projection is
      // the public application seam; ProductShell never reads the Ledger.
      setRoute((requestedRoute) => resolveUserDossierEntryRoute({
        requestedRoute,
        onboardingRequired: onboardingEntry.destination === "onboarding",
      }));
      setOnboardingEntry(onboardingEntry);
      onboardingRequired.current = onboardingEntry.destination === "onboarding";
      setEntryGate("resolved");
      setScreen(projection);
      setError(undefined);
    } catch (cause) {
      setEntryGate("failed");
      setError(cause instanceof Error ? cause.message : "无法读取本地资料");
    } finally {
      setLoading(false);
    }
  }, [application, calendarAnchorDate, calendarMode, date, userId]);

  // Every client-originated Timeline write uses this one completion path.
  // The runtime only settles an already-queued current evaluation, so opening
  // the activity sheet never invents an empty review or a plan adjustment.
  const settleTimelineAndRefresh = useCallback(() => {
    void (async () => {
      try {
        await onTimelineChanged?.();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "已保存记录，但暂时无法完成进度检查");
      } finally {
        await refresh();
      }
    })();
  }, [onTimelineChanged, refresh]);

  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (route === "onboarding" || route === "video_library" || route === "replay") {
      setCoachExpanded(false);
      setCoachAttachment((current) => current ? { ...current, foreground: "minimized" } : undefined);
    }
  }, [route]);
  useEffect(() => {
    const intent = resolveMaxPowerDeepLink(incomingDeepLink ?? notificationDeepLink);
    if (!intent) return;
    // This is intentionally a view-state transition only. In particular, an
    // external Workout URL does not prepare/activate a session or create a
    // Coach session; WorkoutScreen will read the canonical session by id.
    const next = applyInboundNavigationIntent(navigationState.current, intent);
    setRoute(resolveUserDossierEntryRoute({
      requestedRoute: next.route,
      onboardingRequired: onboardingRequired.current,
    }));
    setDate(next.date);
    setCalendarAnchorDate(next.date);
    setCalendarMode(next.calendarMode);
    setWorkoutId(next.workoutId);
    setCoachExpanded(next.coachExpanded);
    setCoachAttachment((current) => current ? { ...current, foreground: "minimized" } : undefined);
  }, [incomingDeepLink, notificationDeepLink]);

  const context = useMemo<ContextRef>(() => ({
    kind: routeContext(route),
    ref: route === "today" || route === "calendar" ? date : route === "plan" ? `plan:${screen?.source.planRevision ?? "none"}` : route === "workout" ? workoutId ?? "active" : route,
  }), [date, route, screen?.source.planRevision, workoutId]);

  // A stream is task-scoped. Moving between Today, a plan, and a Workout
  // must never leave the previous task's parts as the target of the next
  // composer submission; the persisted projection is rehydrated on demand.
  useEffect(() => {
    setCoachExpanded(false);
    setCoachSession(undefined);
    setCoachMessages([]);
    setCoachAttachment((current) => current && !contextAcceptsRestoredCoach(current.context, context, screen === undefined)
      ? { ...current, foreground: "minimized" }
      : current);
    const next = new CoachStreamProjection();
    stream.current = next;
    setStreamSnapshot(next.snapshot());
  }, [context.kind, context.ref]);

  const beginOrResumeWorkout = useCallback(async () => {
    const today = screen?.today;
    if (!today?.session) return;
    try {
      let id = today.activeWorkout?.id;
      if (!id) {
        if (!screen?.source.planId || !screen.source.planRevision) throw new Error("当前计划无法启动训练");
        id = `workout-${Date.now().toString(36)}`;
        const localWorkoutId = id;
        await cloudConfirmed.startWorkoutThen({
          localWorkoutId,
          localPlanId: screen.source.planId,
          title: today.session.title,
          data: { sessionPrescriptionId: today.session.id, mode: "record_only" },
          startedAt: new Date().toISOString(),
          idempotencyKey: `mobile-workout:${localWorkoutId}:start`,
          commitLocal: async () => {
            await application.prepareWorkoutSession({
              userId,
              workoutId: localWorkoutId,
              prescriptionRef: {
                planId: screen.source.planId!,
                planRevision: screen.source.planRevision!,
                sessionPrescriptionId: today.session!.id,
              },
              mode: "record_only",
              idempotencyKey: `mobile-workout:${localWorkoutId}:prepare`,
            });
            await application.activateWorkoutSession({
              userId,
              workoutId: localWorkoutId,
              mode: "record_only",
              idempotencyKey: `mobile-workout:${localWorkoutId}:activate`,
            });
          },
        });
      } else if (today.activeWorkout?.status === "paused") {
        const localWorkoutId = id;
        await cloudConfirmed.updateWorkoutThen({
          localWorkoutId,
          patch: { data: { lifecycle: "resumed" } },
          idempotencyKey: `mobile-workout:${localWorkoutId}:resume:cloud`,
          commitLocal: () => application.resumeWorkoutSession({
            userId,
            workoutId: localWorkoutId,
            idempotencyKey: `mobile-workout:${localWorkoutId}:resume`,
          }),
        });
      }
      setWorkoutId(id);
      setCoachExpanded(false);
      setRoute("workout");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "暂时无法开始训练");
    }
  }, [application, cloudConfirmed, refresh, screen, userId]);

  const requestWorkoutStart = useCallback(() => {
    void beginOrResumeWorkout();
  }, [beginOrResumeWorkout]);

  const resolveCoachSession = useCallback(async (messageContext: ContextRef): Promise<CoachSession | undefined> => {
    if (messageContext.kind === "workout") {
      return application.ensureWorkoutCoachSession({
        userId,
        workoutId: messageContext.ref,
        idempotencyKey: `mobile-workout:${messageContext.ref}:coach-session`,
      });
    }
    const candidates = await application.listCoachSessions({ userId });
    let session = candidates.find(
      (candidate) =>
        candidate.context.kind === messageContext.kind &&
        candidate.context.ref === messageContext.ref &&
        candidate.status === "active",
    ) ?? candidates.find(
      (candidate) =>
        candidate.context.kind === messageContext.kind &&
        candidate.context.ref === messageContext.ref &&
        candidate.status !== "archived" &&
        candidate.status !== "completed",
    );
    if (!session) return undefined;
    if (session.status !== "active") session = await application.setSessionStatus(session.id, "active");
    return session;
  }, [application, userId]);

  const hydrateCoach = useCallback(async () => {
    const [session, sessions] = await Promise.all([
      resolveCoachSession(context),
      application.listCoachSessions({ userId }),
    ]);
    setCoachSessions(sessions.filter((candidate) => candidate.status !== "archived"));
    if (!session) {
      setCoachSession(undefined);
      setCoachMessages([]);
      // A session from another destination may remain minimized while the
      // user navigates. Once the current destination has no matching session,
      // it is stale for this drawer and must not be allowed to close the newly
      // opened surface again.
      setCoachAttachment(undefined);
      return;
    }
    setCoachSession(session);
    setCoachAttachment({
      sessionId: session.id,
      context: session.context,
      foreground: coachExpanded ? "expanded" : "minimized",
    });
    const persisted = await application.readSessionProjection(session.id);
    setCoachMessages(persisted.messages);
    const next = new CoachStreamProjection(persisted.artifacts, undefined, persisted.presentations, persisted.pendingHumanActions);
    persisted.runEvents.forEach((event) => next.accept(event));
    stream.current = next;
    setStreamSnapshot(next.snapshot());
  }, [application, coachExpanded, context, resolveCoachSession]);

  const sendToCoach = useCallback(async (text: string, messageContext: ContextRef) => {
    const optimisticMessage: CoachMessage = {
      id: `ui-message:${Date.now().toString(36)}`,
      sessionId: coachSession?.id ?? "pending-session",
      userId,
      role: "user",
      content: text,
      createdAt: new Date().toISOString(),
    };
    setCoachMessages((current) => [...current, optimisticMessage]);
    try {
      let session = await resolveCoachSession(messageContext);
      if (!session) {
        session = await application.startSession({ userId, context: messageContext });
      } else if (session.status !== "active") {
        session = await application.setSessionStatus(session.id, "active");
      }
      setCoachSession(session);
      setCoachAttachment({
        sessionId: session.id,
        context: session.context,
        foreground: coachExpanded ? "expanded" : "minimized",
      });
      await application.sendCoachTurn({ sessionId: session.id, text });
      await onTimelineChanged?.();
      const afterTurn = await application.readSessionProjection(session.id);
      setCoachMessages(afterTurn.messages);
      const persistedNext = new CoachStreamProjection(afterTurn.artifacts, undefined, afterTurn.presentations, afterTurn.pendingHumanActions);
      afterTurn.runEvents.forEach((event) => persistedNext.accept(event));
      stream.current = persistedNext;
      setStreamSnapshot(persistedNext.snapshot());
      setCoachSessions((await application.listCoachSessions({ userId })).filter((candidate) => candidate.status !== "archived"));
      await refresh();
    } catch (cause) {
      stream.current.fail({
        id: `send-${Date.now()}`,
        message: cause instanceof Error ? cause.message : "暂时无法继续对话",
      });
      setStreamSnapshot(stream.current.snapshot());
      if (cause instanceof Error && cause.message === "remote_llm_permission_required") throw cause;
    }
  }, [application, coachExpanded, coachSession?.id, onTimelineChanged, refresh, resolveCoachSession, userId]);

  const selectCoachSession = useCallback(async (sessionId: string) => {
    try {
      const sessions = await application.listCoachSessions({ userId });
      const session = sessions.find((candidate) => candidate.id === sessionId && candidate.status !== "archived");
      if (!session) throw new Error("这段历史对话已不可用");
      const persisted = await application.readSessionProjection(session.id);
      const next = new CoachStreamProjection(persisted.artifacts, undefined, persisted.presentations, persisted.pendingHumanActions);
      persisted.runEvents.forEach((event) => next.accept(event));
      setCoachSession(session);
      setCoachMessages(persisted.messages);
      setCoachSessions(sessions.filter((candidate) => candidate.status !== "archived"));
      setCoachAttachment({ sessionId: session.id, context: session.context, foreground: "expanded" });
      stream.current = next;
      setStreamSnapshot(next.snapshot());
      setCoachExpanded(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "暂时无法读取历史对话");
    }
  }, [application, userId]);

  const startNewCoachConversation = useCallback(() => {
    setCoachSession(undefined);
    setCoachMessages([]);
    setCoachAttachment(undefined);
    const next = new CoachStreamProjection();
    stream.current = next;
    setStreamSnapshot(next.snapshot());
  }, []);

  const handleCoachExpandedChange = useCallback((expanded: boolean) => {
    setCoachExpanded(expanded);
    setCoachAttachment((current) => {
      if (!current) return current;
      if (expanded && !contextAcceptsRestoredCoach(current.context, context, screen === undefined)) {
        return undefined;
      }
      return {
        ...current,
        foreground: expanded && sameCoachContext(current.context, context) ? "expanded" : "minimized",
      };
    });
    if (expanded) void hydrateCoach();
  }, [context, hydrateCoach, screen]);

  /** The collapsed dock declares the input intent before its composer grows into the conversation surface. */
  const openCoachFromDock = useCallback(() => {
    setCoachEntryMode("text");
    setCoachFocusRequest((current) => current + 1);
    handleCoachExpandedChange(true);
  }, [handleCoachExpandedChange]);

  const openCoachVoiceFromDock = useCallback(() => {
    setCoachEntryMode("voice");
    handleCoachExpandedChange(true);
  }, [handleCoachExpandedChange]);

  // A persisted attachment is only a reference. Rehydrate it by id, without
  // starting a session, changing its lifecycle, or generating a new CoachRun.
  useEffect(() => {
    if (initialShellRecoveryHandled.current) return;
    initialShellRecoveryHandled.current = true;
    const recovery = initialProductShellRecovery;
    if (!recovery) return;
    let active = true;
    void (async () => {
      const attachment = recovery.state.coachAttachment;
      if (attachment) {
        const sessions = await application.listCoachSessions({ userId });
        const session = sessions.find((candidate) =>
          candidate.id === attachment.sessionId &&
          candidate.status !== "archived" &&
          candidate.context.kind === attachment.context.kind &&
          candidate.context.ref === attachment.context.ref,
        );
        if (!active) return;
        if (!session) {
          setCoachAttachment(undefined);
          setCoachExpanded(false);
        } else {
          const canForeground = attachment.foreground === "expanded" && contextAcceptsRestoredCoach(session.context, context, screen === undefined);
          const restoredAttachment: ProductCoachAttachment = {
            sessionId: session.id,
            context: session.context,
            foreground: canForeground ? "expanded" : "minimized",
          };
          setCoachAttachment(restoredAttachment);
          setCoachSession(session);
          setCoachExpanded(canForeground);
          if (canForeground) {
            const persisted = await application.readSessionProjection(session.id);
            if (!active) return;
            setCoachMessages(persisted.messages);
            const next = new CoachStreamProjection(persisted.artifacts, undefined, persisted.presentations, persisted.pendingHumanActions);
            persisted.runEvents.forEach((event) => next.accept(event));
            stream.current = next;
            setStreamSnapshot(next.snapshot());
          }
        }
      }
      if (active) {
        const sessions = await application.listCoachSessions({ userId });
        if (active) setCoachSessions(sessions.filter((candidate) => candidate.status !== "archived"));
      }
      if (recovery.formRecovery.kind === "reopen") {
        try {
          const draft = await application.readNutritionObservationDraft({
            userId,
            artifactId: recovery.formRecovery.form.artifactId,
          });
          if (active) setNutritionDraft(draft);
        } catch {
          // The durable artifact may have been rejected/deleted elsewhere. A
          // missing reference must not be recreated as a new food fact.
        }
      }
    })().catch(() => {
      if (active) {
        setCoachAttachment(undefined);
        setCoachExpanded(false);
      }
    }).finally(() => {
      if (active) setShellRestorationReady(true);
    });
    return () => { active = false; };
  }, [application, context, initialProductShellRecovery, screen, userId]);

  const presentationState = useMemo<ProductShellState>(() => {
    const persistableRoute = isProductDeepLinkRoute(route) ? route : "today";
    const attachment = coachAttachment && contextAcceptsRestoredCoach(coachAttachment.context, context, screen === undefined)
      ? {
          ...coachAttachment,
          foreground: coachExpanded ? "expanded" as const : "minimized" as const,
        }
      : coachAttachment ? { ...coachAttachment, foreground: "minimized" as const } : undefined;
    const unfinishedForm = nutritionDraft
      ? { kind: "nutrition_draft_review" as const, artifactId: nutritionDraft.id, recovery: "reopen_persisted_reference" as const }
      : showActivityLog
        ? { kind: "activity_log" as const, recovery: "discard_on_process_restore" as const }
        : route === "onboarding"
          ? { kind: "onboarding" as const, recovery: "discard_on_process_restore" as const }
          : undefined;
    return {
      navigation: {
        route: persistableRoute,
        date,
        calendarMode,
        coachExpanded: attachment?.foreground === "expanded",
        ...(persistableRoute === "workout" && workoutId ? { workoutId } : {}),
      },
      ...(attachment ? { coachAttachment: attachment } : {}),
      ...(unfinishedForm ? { unfinishedForm } : {}),
    };
  }, [calendarMode, coachAttachment, coachExpanded, context, date, nutritionDraft, route, screen, showActivityLog, workoutId]);

  useEffect(() => {
    if (!productShellStateStore || !shellRestorationReady) return;
    let mounted = true;
    productShellSaveChain.current = productShellSaveChain.current
      .catch(() => undefined)
      .then(() => productShellStateStore.save({ userId, state: presentationState }))
      .catch(() => {
        if (mounted) setError("页面状态暂时无法保存；训练与记录不受影响。");
      });
    return () => { mounted = false; };
  }, [presentationState, productShellStateStore, shellRestorationReady, userId]);

  const handleCardAction = useCallback(async (actionId: string, artifactId: string) => {
    if (actionId === "start_workout") {
      requestWorkoutStart();
      return;
    }
    if (actionId === "open_future_plan_preview") {
      setRoute("plan");
      setCoachExpanded(false);
      await refresh();
      return;
    }
    if (actionId === "review") {
      try {
        setNutritionDraft(await application.readNutritionObservationDraft({ userId, artifactId }));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "暂时无法读取这份餐食估算");
      }
      return;
    }
    if (actionId !== "apply" && actionId !== "reject" && actionId !== "undo" && actionId !== "confirm") {
      setError("此卡片操作尚未在当前客户端提供。");
      return;
    }
    try {
      await application.invokeArtifactCardAction({
        userId,
        artifactId,
        action: actionId,
        idempotencyKey: `mobile-card:${artifactId}:${actionId}:${Date.now().toString(36)}`,
      });
      await hydrateCoach();
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "暂时无法执行这个操作");
    }
  }, [application, hydrateCoach, refresh, requestWorkoutStart, userId]);

  const handleHumanAction = useCallback(async (pendingActionId: string, optionId: string) => {
    try {
      const sessionProjection = coachSession
        ? await application.readSessionProjection(coachSession.id)
        : undefined;
      const pending = sessionProjection?.pendingHumanActions.find((item) => item.id === pendingActionId);
      const isEnergyRebalanceChoice = pending?.prompt.includes("能量回拨提案") === true;
      const preview = screen?.plan.latestPlanningPreview;
      await application.respondToPendingHumanAction({ userId, pendingActionId, optionId });
      if (
        isEnergyRebalanceChoice &&
        preview?.planningPreview?.status === "awaiting_confirmation" &&
        preview.planningPreview.request.requestedScope === "future_plan"
      ) {
        if (optionId === "confirm") {
          const domain = await application.readDomainProjection({ userId });
          await cloudConfirmed.publishPlanThen({
            localPlanId: screen.source.planId ?? preview.id,
            title: "MaxPower 训练计划",
            snapshot: createCloudPlanRecoverySnapshot({
              artifactId: preview.id,
              planningPreview: preview.planningPreview,
              domain,
            }),
            idempotencyKey: `mobile-coach-preview:${preview.id}`,
            commitLocal: () => application.confirmPlanningPreview({
              userId,
              previewId: preview.id,
              idempotencyKey: `mobile-coach-preview:confirm:${preview.id}`,
            }),
          });
        } else if (optionId === "decline") {
          await application.rejectPlanningPreview({
            userId,
            previewId: preview.id,
            idempotencyKey: `mobile-coach-preview:reject:${preview.id}`,
          });
        }
      }
      await hydrateCoach();
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "暂时无法提交这个选择");
    }
  }, [application, cloudConfirmed, coachSession, hydrateCoach, refresh, screen, userId]);

  const commitProductRoute = useCallback((nextRoute: ProductRoute) => {
    const normalizedRoute = nextRoute === "progress" ? "plan" : nextRoute;
    if (normalizedRoute === "today" || normalizedRoute === "plan") setDate(localDate());
    setRoute(normalizedRoute);
  }, []);

  const navigateProductRoute = useCallback((nextRoute: ProductRoute) => {
    const normalizedRoute = nextRoute === "progress" ? "plan" : nextRoute;
    if (isPrimaryProductRoute(route) && isPrimaryProductRoute(normalizedRoute) && primaryPager.current) {
      primaryPager.current.navigate(normalizedRoute);
      return;
    }
    commitProductRoute(normalizedRoute);
  }, [commitProductRoute, route]);

  if (entryGate === "resolving") return <LoadingState />;
  if (entryGate === "failed") return <ErrorState message={error ?? "暂时无法确认档案状态"} onRetry={() => void refresh()} />;
  if (loading && !screen) return <LoadingState />;
  if (error && !screen) return <ErrorState message={error} onRetry={() => void refresh()} />;
  if (!screen) return <LoadingState />;

  return (
    <View style={styles.page}>
      {isPrimaryProductRoute(route) ? <HorizontalRoutePager
        ref={primaryPager}
        current={route}
        onChange={(destination) => {
          if (isPrimaryProductRoute(destination)) commitProductRoute(destination);
        }}
        pages={[
          {
            id: "today",
            content: <TodayScreen application={application} userId={userId} screen={screen} onOpenCalendar={() => navigateProductRoute("calendar")} onOpenCoach={() => handleCoachExpandedChange(true)} onOpenPlan={() => navigateProductRoute("plan")} onStartOnboarding={() => setRoute("onboarding")} onBeginWorkout={requestWorkoutStart} onRecordActivity={() => { setActivityLogInitialMode("activity"); setShowActivityLog(true); }} onRecordMeal={() => { setActivityLogInitialMode("nutrition"); setShowActivityLog(true); }} onCheckIn={() => { setActivityLogInitialMode("recovery"); setShowActivityLog(true); }} onViewWorkoutSummary={setWorkoutSummary} onCorrectTimeline={setTimelineCorrection} onMealDraft={(draft) => setNutritionDraft(draft)} />,
          },
          {
            id: "calendar",
            content: <CalendarScreen
              screen={screen}
              onSelectDate={setDate}
              onPrevious={() => setCalendarAnchorDate((current) => calendarMode === "week" ? shiftCalendarDate(current, -7) : shiftCalendarMonth(current, -1))}
              onNext={() => setCalendarAnchorDate((current) => calendarMode === "week" ? shiftCalendarDate(current, 7) : shiftCalendarMonth(current, 1))}
              onToggleMode={() => setCalendarMode((mode) => mode === "week" ? "month" : "week")}
              onDateGestureActiveChange={(active) => primaryPager.current?.setSwipeEnabled(!active)}
              onDateGestureRegionChange={(region) => primaryPager.current?.setSwipeExclusion({ destination: "calendar", ...region })}
              onViewWorkoutSummary={setWorkoutSummary}
              onCorrectTimeline={setTimelineCorrection}
            />,
          },
          {
            id: "plan",
            content: <PlanScreen initialTab="overview" application={application} cloudConfirmed={cloudConfirmed} userId={userId} screen={screen} onOpenVideoLibrary={() => setRoute("video_library")} onRecordMeal={() => { setActivityLogInitialMode("nutrition"); setShowActivityLog(true); }} onUpdated={() => void refresh()} />,
          },
          {
            id: "profile",
            content: <ProfileScreen application={application} userId={userId} screen={screen} onStartOnboarding={() => setRoute("onboarding")} onOpenAccountSettings={onOpenAccountSettings} onUpdated={() => void refresh()} />,
          },
        ]}
      /> : null}
      {route === "onboarding" && <OnboardingScreen key={userId} application={application} cloudConfirmed={cloudConfirmed} userId={userId} entry={onboardingEntry} messages={coachMessages} onSendConversation={async (text, draftId) => sendToCoach(text, { kind: "onboarding", ref: draftId })} onStartConversation={async (draftId) => { await application.startOnboardingAgentTurn({ userId, draftId }); const session = (await application.listCoachSessions({ userId, taskKind: "onboarding" })).find((candidate) => candidate.context.kind === "onboarding" && candidate.context.ref === draftId && candidate.status !== "archived"); if (session) { const projection = await application.readSessionProjection(session.id); setCoachSession(session); setCoachMessages(projection.messages); } await refresh(); }} onAllowRemoteConversation={async (draftId) => { await application.allowOnboardingRemoteConversation({ draftId }); await refresh(); }} onCompleted={() => { setRoute("today"); void refresh(); }} onProgressSaved={() => void refresh()} />}
      {route === "workout" && workoutId ? <WorkoutScreen application={application} cloudConfirmed={cloudConfirmed} userId={userId} workoutId={workoutId} coachStream={streamSnapshot} onSendToCoach={(text) => sendToCoach(text, context)} onCoachCardAction={handleCardAction} onCoachHumanAction={handleHumanAction} onOpenCoach={() => handleCoachExpandedChange(true)} onFinished={() => { setWorkoutId(undefined); setRoute("today"); settleTimelineAndRefresh(); }} onUnavailable={() => { setWorkoutId(undefined); setRoute("today"); void refresh(); }} onOpenSavedVideo={(selection) => { setReplaySelection(selection); setReplayReturnRoute("workout"); setRoute("replay"); }} locale={screen.profile.locale} /> : null}
      {route === "video_library" && <VideoLibraryScreen application={application} userId={userId} cloudMediaLibrary={cloudMediaLibrary} onOpenReplay={(selection) => { setReplaySelection(selection); setReplayReturnRoute("video_library"); setRoute("replay"); }} />}
      {route === "replay" && replaySelection ? <ReplayScreen {...replaySelection} onExit={() => { setReplaySelection(undefined); setRoute(replayReturnRoute); }} locale={screen.profile.locale} /> : null}

      {error ? <View style={styles.inlineError}><Text style={styles.inlineErrorText}>{error}</Text></View> : null}
      {route !== "onboarding" && route !== "workout" && route !== "video_library" && route !== "replay" ? <ProductDock route={route} coachStatus={streamSnapshot.status} coachExpanded={coachExpanded} onChange={navigateProductRoute} onRecord={() => { setActivityLogInitialMode("training"); setShowActivityLog(true); }} onOpenCoach={openCoachFromDock} onOpenCoachVoice={openCoachVoiceFromDock} onCoachAnchorChange={setCoachComposerAnchor} onRecordAnchorChange={setRecordAnchor} /> : null}
      {coachDrawerAvailableForRoute(route) ? <CoachDrawer
        context={context}
        stream={streamSnapshot}
        session={coachSession}
        messages={coachMessages}
        sessions={coachSessions}
        expanded={coachExpanded}
        bottomInset={route === "workout" ? 16 : APP_DOCK_BODY_HEIGHT}
        dockedComposer={route !== "workout"}
        composerAnchor={route === "workout" ? undefined : coachComposerAnchor}
        focusRequest={coachFocusRequest}
        entryMode={coachEntryMode}
        onExpandedChange={handleCoachExpandedChange}
        onSend={(text, messageContext) => void sendToCoach(text, messageContext)}
        onSelectSession={(sessionId) => void selectCoachSession(sessionId)}
        onStartNew={startNewCoachConversation}
        onCardAction={(actionId, artifactId) => void handleCardAction(actionId, artifactId)}
        onHumanAction={(pendingActionId, optionId) => void handleHumanAction(pendingActionId, optionId)}
      /> : null}
      <RecordFocus
        application={application}
        userId={userId}
        initialMode={activityLogInitialMode}
        referenceWeightKg={screen.profile.referenceWeightKg}
        syncedSleepMinutes={latestImportedSleepMinutes(screen.today.activityLog.entries)}
        visible={showActivityLog}
        anchor={recordAnchor}
        onDismiss={() => setShowActivityLog(false)}
        onSaved={() => { setShowActivityLog(false); settleTimelineAndRefresh(); }}
        onAskCoach={(prompt) => {
          setShowActivityLog(false);
          setCoachFocusRequest((current) => current + 1);
          handleCoachExpandedChange(true);
          void sendToCoach(prompt, context);
        }}
        onEstimateMeal={(description) => {
          void (async () => {
            try {
              const draft = await application.createNutritionObservationDraft({
                userId,
                idempotencyKey: `mobile-nutrition-estimate:${Date.now().toString(36)}`,
                occurredAt: new Date().toISOString(),
                request: {
                  text: description,
                  inputProvenance: ["text"],
                  mediaConsent: "not_requested",
                  purpose: "meal_estimate",
                },
              });
              setShowActivityLog(false);
              setNutritionDraft(draft);
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : "暂时无法估算这餐");
            }
          })();
        }}
      />
      {timelineCorrection ? <TimelineCorrectionSheet application={application} userId={userId} entry={timelineCorrection} onDismiss={() => setTimelineCorrection(undefined)} onSaved={() => { setTimelineCorrection(undefined); settleTimelineAndRefresh(); }} /> : null}
      {workoutSummary ? <WorkoutOutcomeSummarySheet summary={workoutSummary} onDismiss={() => setWorkoutSummary(undefined)} onCorrect={() => { setWorkoutCorrectionId(workoutSummary.id); setWorkoutSummary(undefined); }} /> : null}
      {workoutCorrectionId ? <WorkoutOutcomeCorrectionSheet application={application} userId={userId} workoutId={workoutCorrectionId} onDismiss={() => setWorkoutCorrectionId(undefined)} onSaved={() => { setWorkoutCorrectionId(undefined); settleTimelineAndRefresh(); }} /> : null}
      {nutritionDraft ? <NutritionObservationDraftSheet
        artifact={nutritionDraft}
        busy={nutritionDraftBusy}
        locale={screen.profile.locale}
        onDismiss={() => { if (!nutritionDraftBusy) setNutritionDraft(undefined); }}
        onConfirm={(edits) => {
          setNutritionDraftBusy(true);
          void (async () => {
            try {
              await application.confirmNutritionObservationDraft({
                userId,
                artifactId: nutritionDraft.id,
                edits,
                idempotencyKey: `mobile-nutrition-draft:${nutritionDraft.id}:confirm:${Date.now().toString(36)}`,
              });
              await onTimelineChanged?.();
              setNutritionDraft(undefined);
              await hydrateCoach();
              await refresh();
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : "暂时无法确认这份餐食记录");
            } finally {
              setNutritionDraftBusy(false);
            }
          })();
        }}
        onReject={() => {
          setNutritionDraftBusy(true);
          void (async () => {
            try {
              await application.rejectNutritionObservationDraft({
                userId,
                artifactId: nutritionDraft.id,
                idempotencyKey: `mobile-nutrition-draft:${nutritionDraft.id}:reject:${Date.now().toString(36)}`,
              });
              setNutritionDraft(undefined);
              await hydrateCoach();
              await refresh();
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : "暂时无法放弃这份餐食估算");
            } finally {
              setNutritionDraftBusy(false);
            }
          })();
        }}
      /> : null}
    </View>
  );
}

function CloudCanonicalStatus({
  projection,
  error,
  onRetry,
}: {
  projection: ProductShellCloudProjection;
  error?: string;
  onRetry(): void;
}) {
  const plan = projection.plans[0];
  const workout = projection.workouts[0];
  const result = projection.results[0];
  return (
    <View style={styles.cloudCanonicalStatus}>
      <View style={styles.cloudCanonicalHeading}>
        <Text style={styles.cloudCanonicalTitle}>云端已确认 · {projection.profile.displayName ?? "MaxPower 账号"}</Text>
        {error ? <Pressable accessibilityRole="button" onPress={onRetry}><Text style={styles.cloudCanonicalRetry}>重试</Text></Pressable> : null}
      </View>
      <Text numberOfLines={1} style={styles.cloudCanonicalMeta}>
        计划 {plan?.title ?? "暂无"} · 训练 {workout?.title ?? "暂无"} · 结果 {result?.kind ?? "暂无"}
      </Text>
      {error ? <Text style={styles.cloudCanonicalError}>{error}</Text> : null}
    </View>
  );
}

function TodayScreen({ application, userId, screen, onOpenCalendar, onOpenCoach, onOpenPlan, onStartOnboarding, onBeginWorkout, onRecordActivity, onRecordMeal, onCheckIn, onViewWorkoutSummary, onCorrectTimeline, onMealDraft }: { application: CoachApplication; userId: string; screen: CoachProductProjection; onOpenCalendar: () => void; onOpenCoach: () => void; onOpenPlan: () => void; onStartOnboarding: () => void; onBeginWorkout: () => void; onRecordActivity: () => void; onRecordMeal: () => void; onCheckIn: () => void; onViewWorkoutSummary: (summary: WorkoutOutcomeProductSummary) => void; onCorrectTimeline: (entry: TimelineReadEvent) => void; onMealDraft: (draft: NutritionObservationDraftArtifact) => void }) {
  const { today, coach } = screen;
  const [dashboardTab, setDashboardTab] = useState<"training" | "nutrition">("training");
  const preview = screen.plan.latestPlanningPreview;
  const hasRiskAdjustment = Boolean(
    preview?.planningPreview?.status === "awaiting_confirmation"
    && preview.planningPreview.sourceRiskEvaluationId,
  );
  return (
    <ScrollView contentContainerStyle={[styles.content, styles.dockContent]} showsVerticalScrollIndicator={false}>
      <View style={styles.todayHeader}>
        <View><Text style={styles.todayKicker}>TODAY / {weekDayLabel(today.date)}</Text><Text style={styles.date}>{shortDate(today.date)}</Text></View>
        <Pressable accessibilityRole="button" accessibilityLabel="打开日历" hitSlop={10} onPress={onOpenCalendar}>
          <Text style={styles.calendarLink}>日历</Text>
        </Pressable>
      </View>
      <DashboardFlipCard
        value={dashboardTab}
        training={<TodayCard today={today} onFlip={() => setDashboardTab("nutrition")} onStartOnboarding={onStartOnboarding} onBeginWorkout={onBeginWorkout} onRecordActivity={onRecordActivity} onViewWorkoutSummary={onViewWorkoutSummary} />}
        nutrition={<NutritionLedgerCard application={application} userId={userId} date={today.date} nutrition={today.nutrition} onFlip={() => setDashboardTab("training")} onRecordMeal={onRecordMeal} onMealDraft={onMealDraft} />}
      />
      {dashboardTab === "training" ? <RecoveryStatusCard recovery={today.recovery} onCheckIn={onCheckIn} /> : null}
      {hasRiskAdjustment ? <Pressable accessibilityRole="button" accessibilityLabel="查看待确认的进度调整" onPress={onOpenPlan} style={styles.pendingPreviewCard}><View><Text style={styles.pendingPreviewKicker}>PLAN CHECK READY</Text><Text style={styles.pendingPreviewTitle}>最新记录需要调整后续安排</Text><Text style={styles.pendingPreviewMeta}>当前计划不会自动改变；查看方案后由你确认。</Text></View><Text style={styles.pendingPreviewArrow}>›</Text></Pressable> : null}
      {today.activityLog.entries.length ? <>
        <SectionHeading title="今天已记录" meta={`${today.activityLog.entries.length} 条`} />
        <Timeline entries={today.activityLog.entries} onCorrect={onCorrectTimeline} />
      </> : null}
      {coach.pending ? <CoachPending prompt={coach.pending.prompt} /> : null}
    </ScrollView>
  );
}

function DashboardFlipCard({ value, training, nutrition }: { value: "training" | "nutrition"; training: React.ReactNode; nutrition: React.ReactNode }) {
  const flipProgress = useRef(new Animated.Value(value === "training" ? 0 : 1)).current;
  const stageHeight = useRef(new Animated.Value(DASHBOARD_CARD_MIN_HEIGHT)).current;
  const [trainingHeight, setTrainingHeight] = useState(DASHBOARD_CARD_MIN_HEIGHT);
  const [nutritionHeight, setNutritionHeight] = useState(DASHBOARD_CARD_MIN_HEIGHT);

  useEffect(() => {
    Animated.timing(flipProgress, {
      toValue: value === "training" ? 0 : 1,
      duration: 430,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [flipProgress, value]);

  useEffect(() => {
    Animated.timing(stageHeight, {
      // A flip changes content, not the physical card the user is touching.
      // Keep the shared frame as tall as the larger face so it never shrinks.
      toValue: Math.max(trainingHeight, nutritionHeight),
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [nutritionHeight, stageHeight, trainingHeight, value]);

  const trainingRotation = flipProgress.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "180deg"],
  });
  const nutritionRotation = flipProgress.interpolate({
    inputRange: [0, 1],
    outputRange: ["180deg", "360deg"],
  });
  const trainingOpacity = flipProgress.interpolate({
    inputRange: [0, 0.499, 0.5, 1],
    outputRange: [1, 1, 0, 0],
  });
  const nutritionOpacity = flipProgress.interpolate({
    inputRange: [0, 0.499, 0.5, 1],
    outputRange: [0, 0, 1, 1],
  });

  return <Animated.View style={[styles.dashboardFlipStage, { height: stageHeight }]}>
    <Animated.View
      accessibilityElementsHidden={value !== "training"}
      importantForAccessibility={value === "training" ? "auto" : "no-hide-descendants"}
      onLayout={(event) => setTrainingHeight(Math.max(DASHBOARD_CARD_MIN_HEIGHT, Math.ceil(event.nativeEvent.layout.height)))}
      pointerEvents={value === "training" ? "auto" : "none"}
      style={[styles.dashboardFlipFace, { opacity: trainingOpacity, transform: [{ perspective: 1100 }, { rotateY: trainingRotation }] }]}
    >
      {training}
    </Animated.View>
    <Animated.View
      accessibilityElementsHidden={value !== "nutrition"}
      importantForAccessibility={value === "nutrition" ? "auto" : "no-hide-descendants"}
      onLayout={(event) => setNutritionHeight(Math.max(DASHBOARD_CARD_MIN_HEIGHT, Math.ceil(event.nativeEvent.layout.height)))}
      pointerEvents={value === "nutrition" ? "auto" : "none"}
      style={[styles.dashboardFlipFace, { opacity: nutritionOpacity, transform: [{ perspective: 1100 }, { rotateY: nutritionRotation }] }]}
    >
      {nutrition}
    </Animated.View>
  </Animated.View>;
}

function latestImportedSleepMinutes(entries: readonly TimelineReadEvent[]): number | undefined {
  const entry = [...entries].reverse().find((candidate) =>
    candidate.fact.kind === "sleep" &&
    (candidate.envelope?.provenance.origin === "health_connect" || candidate.envelope?.provenance.origin === "healthkit") &&
    candidate.fact.duration?.unit === "minutes",
  );
  return entry?.fact.kind === "sleep" ? entry.fact.duration?.value : undefined;
}

function RecoveryStatusCard({ recovery, onCheckIn }: { recovery: CoachProductProjection["today"]["recovery"]; onCheckIn: () => void }) {
  const label = recovery.level === "normal" ? "按原计划" : recovery.level === "slight_reduction" ? "稍微放缓" : recovery.level === "recovery_priority" ? "优先恢复" : "暂停并确认";
  return <View style={styles.recoveryStatusCard}>
    <View style={styles.sectionHeader}><View><Text style={[styles.cardEyebrow, styles.intakeEyebrow]}>今日恢复</Text><Text style={styles.detailTitle}>{label}</Text></View><Text style={styles.detailMeta}>{recovery.validUntil ? `复核 ${recovery.validUntil.slice(0, 10)}` : "尚未记录"}</Text></View>
    <Text style={styles.detailMeta}>{recovery.reasons.map((reason) => recoveryReasonLabel(reason)).join("、") || "没有需要降低训练量的恢复信号"}</Text>
    {recovery.missing.length ? <Text style={styles.detailMeta}>待补充：{recovery.missing.map((reason) => recoveryReasonLabel(reason)).join("、")}</Text> : null}
    <Pressable accessibilityRole="button" onPress={onCheckIn} style={styles.recoveryCheckInButton}><Text style={styles.recoveryCheckInText}>记录睡眠 / 疲劳 / 酸痛</Text></Pressable>
  </View>;
}

function NutritionLedgerCard({ application, userId, date, nutrition, onFlip, onRecordMeal, onMealDraft }: { application: CoachApplication; userId: string; date: string; nutrition: CoachProductProjection["today"]["nutrition"]; onFlip: () => void; onRecordMeal: () => void; onMealDraft: (draft: NutritionObservationDraftArtifact) => void }) {
  const [recommendation, setRecommendation] = useState<NextMealRecommendation>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const labels = { protein: "蛋白质", carbohydrate: "碳水", fat: "脂肪" } as const;
  return <View style={[styles.nutritionLedgerCard, styles.dashboardNutritionCard]}>
    <View style={styles.nutritionCardHeader}>
      <Text style={styles.nutritionCardTitle}>今日摄入</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="翻回训练卡片" onPress={onFlip} style={({ pressed }) => [styles.cardFlipButtonLight, pressed && styles.cardFlipButtonPressed]}><Text style={styles.cardFlipButtonLightText}>↻ 训练</Text></Pressable>
    </View>
    <View style={styles.intakeOverviewRow}>
      <DailyFuelRing budget={nutrition.budget} size={132} />
      <View style={styles.intakeOverviewCopy}>
        <Text style={styles.intakeDayLabel}>今日目标</Text>
        <Text style={styles.intakeTargetValue}>{nutrition.budget.recommendedKcal === undefined ? "—" : nutrition.budget.recommendedKcal.toLocaleString()}</Text>
        <Text style={styles.intakeTargetUnit}>kcal</Text>
        {nutrition.budget.activityAdjustmentKcal > 0 ? <Text style={styles.intakeActivityCredit}>活动 +{nutrition.budget.activityAdjustmentKcal} kcal</Text> : null}
        {nutrition.budget.recommendedRange ? <Text style={styles.intakeTargetRange}>{nutrition.budget.recommendedRange.min.toLocaleString()}–{nutrition.budget.recommendedRange.max.toLocaleString()}</Text> : null}
      </View>
    </View>
    <View style={styles.nutritionMacroStrip}>
      {(Object.keys(labels) as (keyof typeof labels)[]).map((nutrient) => {
        const value = nutrition.ledger.nutrients[nutrient];
        const target = value.target;
        return <View key={nutrient} style={styles.nutritionMacroItem}><Text style={styles.nutritionProgressLabel}>{labels[nutrient]}</Text><Text style={styles.nutritionMacroValue}>{value.intakeKnown ? `${Math.round(value.consumedLogged)} g` : "—"}</Text>{target === undefined ? null : <Text style={styles.nutritionProgressMeta}>目标 {Math.round(target)} g</Text>}</View>;
      })}
    </View>
    {nutrition.ledger.meals.length ? <View style={styles.nutritionMealList}>{nutrition.ledger.meals.map((meal) => <View key={meal.eventId} style={styles.nutritionMealRow}><Text style={styles.nutritionMealTitle}>{meal.description ?? meal.slot}</Text><Text style={styles.nutritionMealMeta}>{meal.confirmed ? "已确认" : "待确认"}{meal.nutrients?.energy !== undefined ? ` · ${Math.round(meal.nutrients.energy)} kcal` : " · 数值未知"}</Text></View>)}</View> : null}
    {recommendation ? <View style={styles.nutritionRecommendationList}>{recommendation.candidates.map((candidate) => <Pressable key={candidate.id} accessibilityRole="button" disabled={busy} onPress={() => { setBusy(true); void application.selectNextMealRecommendation({ userId, recommendation, candidateId: candidate.id, idempotencyKey: `mobile-meal-draft:${candidate.id}` }).then(onMealDraft).catch((cause) => setError(cause instanceof Error ? cause.message : "推荐已变化，请重新计算")).finally(() => setBusy(false)); }} style={styles.nutritionRecommendationRow}><View style={styles.nutritionRecommendationBody}><Text style={styles.nutritionRecommendationTitle}>{candidate.title}</Text><Text style={styles.nutritionMealMeta}>{candidate.assumptions.join(" · ")}</Text></View><Text style={styles.chevron}>›</Text></Pressable>)}</View> : null}
    {error ? <Text style={styles.formError}>{error}</Text> : null}
    <View style={styles.nutritionButtonRow}><Pressable accessibilityRole="button" onPress={onRecordMeal} style={styles.nutritionRecordButton}><Text style={styles.nutritionRecordButtonText}>记录餐食</Text></Pressable><Pressable accessibilityRole="button" disabled={busy} onPress={() => { setBusy(true); void application.createNextMealRecommendation({ userId, date, timezoneOffsetMinutes: new Date().getTimezoneOffset() * -1, mealSlot: "snack" }).then(setRecommendation).catch((cause) => setError(cause instanceof Error ? cause.message : "暂时无法生成下一餐")).finally(() => setBusy(false)); }} style={styles.nutritionSuggestButton}><Text style={styles.nutritionSuggestButtonText}>{busy ? "处理中" : "推荐下一餐"}</Text></Pressable></View>
  </View>;
}

function DailyFuelRing({ budget, size = 148 }: { budget: DailyIntakeBudget; size?: number }) {
  const palette = intakePalette(budget.status);
  const center = size / 2;
  const radiusValue = center - 15;
  const circumference = 2 * Math.PI * radiusValue;
  const progress = clampNumber(budget.progressRatio ?? 0, 0, 1);
  const overflow = clampNumber((budget.progressRatio ?? 1) - 1, 0, 0.25) / 0.25;
  const percentage = budget.progressRatio === undefined ? undefined : Math.round(budget.progressRatio * 100);
  return <View accessibilityLabel={budget.consumedKcal === undefined ? "今日摄入尚未完整量化" : `已摄入 ${budget.consumedKcal} 千卡，完成建议目标的 ${percentage} 百分比`} style={[styles.intakeRingWrap, { width: size, height: size }]}>
    <Svg width={size} height={size}>
      <Circle cx={center} cy={center} r={radiusValue} fill="none" stroke={colors.paper2} strokeWidth={10} />
      <Circle cx={center} cy={center} r={radiusValue} fill="none" stroke={palette.color} strokeWidth={10} strokeLinecap="round" strokeDasharray={`${circumference} ${circumference}`} strokeDashoffset={circumference * (1 - progress)} transform={`rotate(-90 ${center} ${center})`} />
      {overflow > 0 ? <Circle cx={center} cy={center} r={radiusValue + 8} fill="none" stroke={palette.color} strokeWidth={3} strokeLinecap="round" strokeDasharray={`${2 * Math.PI * (radiusValue + 8)} ${2 * Math.PI * (radiusValue + 8)}`} strokeDashoffset={2 * Math.PI * (radiusValue + 8) * (1 - overflow)} transform={`rotate(-90 ${center} ${center})`} /> : null}
    </Svg>
    <View style={styles.intakeRingCenter}>
      <Text style={[styles.intakeRingValue, { color: palette.ink }]}>{budget.consumedKcal === undefined ? "—" : budget.consumedKcal.toLocaleString()}</Text>
      <Text style={styles.intakeRingUnit}>kcal</Text>
      {percentage !== undefined ? <Text style={[styles.intakeRingPercent, { color: palette.ink }]}>{percentage}%</Text> : null}
    </View>
  </View>;
}

function CoachNotice({ screen, onOpenCoach }: { screen: CoachProductProjection; onOpenCoach: () => void }) {
  const notice = screen.coach.pending
    ? "有一项需要确认"
    : screen.coach.latestUndoableAction
      ? "最近的调整仍可撤销"
      : undefined;
  if (!notice) return <View style={styles.noticeSpacer} />;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="查看 Coach 动态" onPress={onOpenCoach} style={styles.coachNotice}>
      <View style={styles.noticeDot} />
      <Text style={styles.coachNoticeText}>{notice}</Text>
      <Text style={styles.noticeChevron}>›</Text>
    </Pressable>
  );
}

function TodayCard({ today, onFlip, onStartOnboarding, onBeginWorkout, onRecordActivity, onViewWorkoutSummary }: { today: CoachProductProjection["today"]; onFlip: () => void; onStartOnboarding: () => void; onBeginWorkout: () => void; onRecordActivity: () => void; onViewWorkoutSummary: (summary: WorkoutOutcomeProductSummary) => void }) {
  const copy = todayCopy(today);
  const canTakeAction = ["open_onboarding", "start_workout", "continue_workout", "record_activity"].includes(today.action) || (today.action === "view_summary" && Boolean(today.completedWorkout));
  const takeAction = () => {
    if (today.action === "open_onboarding") onStartOnboarding();
    else if (today.action === "record_activity") onRecordActivity();
    else if (today.action === "view_summary" && today.completedWorkout) onViewWorkoutSummary(today.completedWorkout);
    else if (today.action === "start_workout" || today.action === "continue_workout") onBeginWorkout();
  };
  return (
    <View style={styles.todayCard}>
      <View style={styles.summaryArea}>
        <Pressable accessibilityRole="button" accessibilityLabel="翻到饮食卡片" onPress={onFlip} style={({ pressed }) => [styles.cardFlipButtonDark, pressed && styles.cardFlipButtonPressed]}><Text style={styles.cardFlipButtonDarkText}>↻ 饮食</Text></Pressable>
        <Text style={styles.cardEyebrow}>今日计划</Text>
        <Text style={styles.planTitle} numberOfLines={2}>{today.session ? readablePlanSessionTitle(today.session.title) : copy.title}</Text>
        <Text style={styles.planSubtitle} numberOfLines={1}>{copy.subtitle}</Text>
        <View style={styles.metricsRow}>
          <Metric value={today.session?.estimatedMinutes ? `${today.session.estimatedMinutes}′` : "—"} label="预计时长" />
          <Metric value={today.session ? String(today.session.totalSetCount || today.session.taskCount) : "—"} label={today.session?.kind === "cardio" ? "目标项目" : "工作组"} />
          <Metric value={today.activeWorkout?.status === "paused" ? "已暂停" : today.activeWorkout?.status === "active" ? "进行中" : today.session?.kind === "rest" ? "恢复" : ""} label="状态" />
        </View>
      </View>
      <View style={styles.taskArea}>
        {today.session?.actions.length ? (
          <ScrollView nestedScrollEnabled showsVerticalScrollIndicator={false} contentContainerStyle={styles.taskScroll}>
            {today.session.actions.map((task, index) => (
              <View style={styles.taskRow} key={task.id}>
                <Text numberOfLines={1} style={styles.taskName}>{humanizeExerciseLabel(task.label)}</Text>
                <Text numberOfLines={1} style={styles.taskSummary}>{task.summary}{task.targetRir !== undefined ? ` · RIR ${task.targetRir}` : ""}</Text>
                {index < today.session!.actions.length - 1 ? <View style={styles.rowDivider} /> : null}
              </View>
            ))}
          </ScrollView>
        ) : (
          <View style={styles.planEmpty}><Text style={styles.planEmptyText}>{copy.empty}</Text></View>
        )}
      </View>
      <View style={styles.cardFooter}>
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: !canTakeAction }} disabled={!canTakeAction} onPress={takeAction} style={[styles.primaryButton, styles.todayPrimaryButton, !canTakeAction && styles.primaryButtonDisabled]}>
          <Text style={styles.primaryButtonText}>{copy.action}</Text>
          <View style={styles.primaryButtonArrow}><Text style={styles.primaryButtonArrowText}>→</Text></View>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * Read-only outcome surface shared by Today and Calendar. The object comes
 * from the canonical product projection, so reopening it after navigation
 * never relies on a component-local "training complete" state.
 */
function WorkoutOutcomeSummarySheet({
  summary,
  onDismiss,
  onCorrect,
}: {
  summary: WorkoutOutcomeProductSummary;
  onDismiss: () => void;
  onCorrect: () => void;
}) {
  return (
    <View accessibilityViewIsModal style={styles.logScrim}>
      <Pressable accessibilityRole="button" accessibilityLabel="关闭训练日报" onPress={onDismiss} style={StyleSheet.absoluteFill} />
      <View style={styles.outcomeSheet}>
        <View style={styles.sheetHandle} />
        <Text style={styles.cardEyebrow}>训练日报</Text>
        <Text style={styles.outcomeTitle}>{readablePlanSessionTitle(summary.title)}</Text>
        <Text style={styles.outcomeStatus}>{outcomeStatusLabel(summary.status)}</Text>
        <View style={styles.outcomeMetricRow}>
          <OutcomeMetric value={String(summary.completedWorkSets)} label="完成工作组" />
          <OutcomeMetric value={String(summary.incompleteSetCount)} label="未完成组" />
          <OutcomeMetric value={outcomeCompletenessLabel(summary.dataCompleteness)} label="记录来源" />
        </View>
        <View style={styles.outcomeFacts}>
          <View style={styles.outcomeFactRow}><Text style={styles.outcomeFactLabel}>计划日期</Text><Text style={styles.outcomeFactValue}>{shortDate(summary.scheduledFor)}</Text></View>
          <View style={styles.outcomeFactRow}><Text style={styles.outcomeFactLabel}>实际结束</Text><Text style={styles.outcomeFactValue}>{localDateTime(summary.completedAt)}</Text></View>
        </View>
        <Text style={styles.outcomeBoundary}>计划与实际完成内容分别保留。需要修正时会新增一条更正记录。</Text>
        <Pressable accessibilityRole="button" onPress={onCorrect} style={styles.outcomeCorrectionButton}><Text style={styles.outcomeCorrectionButtonText}>更正训练记录</Text></Pressable>
        <Pressable accessibilityRole="button" onPress={onDismiss} style={styles.primaryButton}><Text style={styles.primaryButtonText}>完成</Text></Pressable>
      </View>
    </View>
  );
}

function OutcomeMetric({ value, label }: { value: string; label: string }) {
  return <View style={styles.outcomeMetric}><Text style={styles.outcomeMetricValue} numberOfLines={1}>{value}</Text><Text style={styles.outcomeMetricLabel}>{label}</Text></View>;
}

/** A low-friction, offline-first entry point for the day's factual Timeline. */
function ActivityLogEntry({
  application,
  userId,
  initialMode,
  onDismiss,
  onSaved,
}: {
  application: CoachApplication;
  userId: string;
  initialMode?: ActivityLogMode;
  onDismiss: () => void;
  onSaved: () => void;
}) {
  const [entryMode, setEntryMode] = useState<ActivityLogMode>(initialMode ?? "activity");
  const [activityType, setActivityType] = useState(initialMode === "nutrition" ? "早餐" : "散步");
  const [durationMinutes, setDurationMinutes] = useState("");
  const [intensity, setIntensity] = useState<"easy" | "moderate" | "hard" | "unknown">("moderate");
  const [score, setScore] = useState("3");
  const [bodyMetric, setBodyMetric] = useState<"body_weight" | "body_fat_percentage">("body_weight");
  const [nutritionMode, setNutritionMode] = useState<"simplified" | "precise">("simplified");
  const [nutritionProvenance, setNutritionProvenance] = useState<"manual" | "label">("manual");
  const [energyKcal, setEnergyKcal] = useState("");
  const [proteinGrams, setProteinGrams] = useState("");
  const [fatGrams, setFatGrams] = useState("");
  const [carbohydrateGrams, setCarbohydrateGrams] = useState("");
  const [proteinCompletion, setProteinCompletion] = useState<"none" | "partial" | "met">("partial");
  const [hunger, setHunger] = useState<"low" | "moderate" | "high">("moderate");
  const [deviation, setDeviation] = useState<"none" | "small" | "large">("none");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const save = async () => {
    const minutes = optionalFiniteNumber(durationMinutes);
    if (entryMode === "activity" && !activityType.trim()) { setError("请写下今天做了什么。"); return; }
    if (entryMode === "activity" && minutes !== undefined && (!Number.isFinite(minutes) || minutes < 0)) { setError("时长需要是非负数字。"); return; }
    const scoreValue = optionalFiniteNumber(score);
    if ((entryMode === "sleep" || entryMode === "recovery") && (scoreValue === undefined || scoreValue < 1 || scoreValue > 5)) { setError("请用 1 到 5 记录主观感受。"); return; }
    if (entryMode === "sleep" && (minutes === undefined || minutes <= 0)) { setError("请填写睡眠时长。"); return; }
    if (entryMode === "body" && (scoreValue === undefined || scoreValue <= 0 || (bodyMetric === "body_fat_percentage" && scoreValue > 100))) { setError(bodyMetric === "body_weight" ? "请填写体重。" : "体脂率需要在 0 到 100 之间。"); return; }
    setSaving(true);
    try {
      const now = new Date();
      if (entryMode === "nutrition") {
        const observation = createManualMealObservation({
          id: `manual-meal:${now.getTime()}`,
          occurredAt: now.toISOString(),
          description: activityType,
          mealSlot: mealSlotForLabel(activityType),
          foods: [{
            id: `manual-food:${now.getTime()}`,
            name: activityType,
            portion: "用户记录的一份餐食",
            ...(optionalFiniteNumber(energyKcal) !== undefined ? { energy: { value: optionalFiniteNumber(energyKcal)!, unit: "kcal" as const } } : {}),
            ...(optionalFiniteNumber(proteinGrams) !== undefined ? { proteinGrams: optionalFiniteNumber(proteinGrams) } : {}),
            ...(optionalFiniteNumber(fatGrams) !== undefined ? { fatGrams: optionalFiniteNumber(fatGrams) } : {}),
            ...(optionalFiniteNumber(carbohydrateGrams) !== undefined ? { carbohydrateGrams: optionalFiniteNumber(carbohydrateGrams) } : {}),
            source: nutritionProvenance,
          }],
          mode: nutritionMode,
          provenance: nutritionMode === "simplified" ? "manual" : nutritionProvenance,
          ...(nutritionMode === "precise" ? {
            ...(optionalFiniteNumber(energyKcal) === undefined ? {} : { energyKcal: optionalFiniteNumber(energyKcal) }),
            ...(optionalFiniteNumber(proteinGrams) === undefined ? {} : { proteinGrams: optionalFiniteNumber(proteinGrams) }),
            ...(optionalFiniteNumber(fatGrams) === undefined ? {} : { fatGrams: optionalFiniteNumber(fatGrams) }),
            ...(optionalFiniteNumber(carbohydrateGrams) === undefined ? {} : { carbohydrateGrams: optionalFiniteNumber(carbohydrateGrams) }),
          } : {
            simplified: { proteinCompletion, hunger, deviation },
          }),
        });
        await application.confirmMealObservation({
          userId,
          idempotencyKey: `mobile-meal:${now.getTime()}`,
          source: observation.provenance,
          observation,
        });
        onSaved();
        return;
      }
      await application.recordTimelineFact({
        userId,
        idempotencyKey: `mobile-activity:${now.getTime()}`,
        fact: entryMode === "activity"
          ? {
              kind: "activity" as const,
              activityType: activityType.trim(),
              ...(minutes === undefined ? {} : { duration: { value: minutes, unit: "minutes" as const } }),
              intensity,
              confidence: "confirmed" as const,
            }
          : entryMode === "sleep" ? {
              kind: "sleep" as const,
              duration: { value: minutes!, unit: "minutes" as const },
              quality: scoreValue,
              confidence: "confirmed" as const,
            } : entryMode === "recovery" ? {
              kind: "recovery" as const,
              perceivedRecovery: scoreValue,
              confidence: "confirmed" as const,
            } : {
              kind: "body" as const,
              measurement: bodyMetric === "body_weight"
                ? { metric: "body_weight" as const, quantity: { value: scoreValue!, unit: "kg" as const } }
                : { metric: "body_fat_percentage" as const, quantity: { value: scoreValue!, unit: "percent" as const } },
              confidence: "confirmed" as const,
            },
        envelope: {
          time: { startedAt: now.toISOString(), timezoneOffsetMinutes: -now.getTimezoneOffset() },
          provenance: { origin: "manual", recordingMethod: "manual_entry", dataStatus: "available", confidence: "confirmed" },
          privacyClass: "sensitive",
          causalRefs: [],
          evidenceRefs: [],
          layer: "raw_observation",
        },
      });
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "暂时未能保存记录");
    } finally {
      setSaving(false);
    }
  };
  return (
    <BottomDrawer visible tall title="统一记录" subtitle="活动、饮食、睡眠、恢复与身体数据" onDismiss={onDismiss}>
      <ScrollView contentContainerStyle={styles.logDrawerContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Text style={styles.cardEyebrow}>活动记录</Text>
        <Text style={styles.logTitle}>{entryMode === "activity" ? "今天做了什么？" : entryMode === "nutrition" ? "这一餐吃了什么？" : entryMode === "sleep" ? "昨晚睡得怎样？" : entryMode === "recovery" ? "现在恢复得怎样？" : "记录身体状态"}</Text>
        <View style={styles.logModeRow}>
          <Pressable accessibilityRole="tab" accessibilityState={{ selected: entryMode === "activity" }} onPress={() => { setEntryMode("activity"); setActivityType("散步"); }} style={[styles.logMode, entryMode === "activity" && styles.logModeSelected]}><Text style={[styles.logModeText, entryMode === "activity" && styles.logModeTextSelected]}>活动</Text></Pressable>
          <Pressable accessibilityRole="tab" accessibilityState={{ selected: entryMode === "nutrition" }} onPress={() => { setEntryMode("nutrition"); setActivityType("早餐"); setNutritionMode("simplified"); }} style={[styles.logMode, entryMode === "nutrition" && styles.logModeSelected]}><Text style={[styles.logModeText, entryMode === "nutrition" && styles.logModeTextSelected]}>饮食</Text></Pressable>
          <Pressable accessibilityRole="tab" accessibilityState={{ selected: entryMode === "sleep" }} onPress={() => { setEntryMode("sleep"); setScore("3"); }} style={[styles.logMode, entryMode === "sleep" && styles.logModeSelected]}><Text style={[styles.logModeText, entryMode === "sleep" && styles.logModeTextSelected]}>睡眠</Text></Pressable>
          <Pressable accessibilityRole="tab" accessibilityState={{ selected: entryMode === "recovery" }} onPress={() => { setEntryMode("recovery"); setScore("3"); }} style={[styles.logMode, entryMode === "recovery" && styles.logModeSelected]}><Text style={[styles.logModeText, entryMode === "recovery" && styles.logModeTextSelected]}>恢复</Text></Pressable>
          <Pressable accessibilityRole="tab" accessibilityState={{ selected: entryMode === "body" }} onPress={() => { setEntryMode("body"); setScore(""); }} style={[styles.logMode, entryMode === "body" && styles.logModeSelected]}><Text style={[styles.logModeText, entryMode === "body" && styles.logModeTextSelected]}>身体</Text></Pressable>
        </View>
        {(entryMode === "activity" || entryMode === "nutrition") ? <View style={styles.logQuickRow}>
          {(entryMode === "activity" ? ["散步", "有氧", "拉伸", "休息"] : ["早餐", "午餐", "晚餐", "加餐"]).map((value) => <Pressable key={value} accessibilityRole="button" onPress={() => setActivityType(value)} style={[styles.logQuick, activityType === value && styles.logQuickSelected]}><Text style={[styles.logQuickText, activityType === value && styles.logQuickTextSelected]}>{value}</Text></Pressable>)}
        </View> : null}
        {(entryMode === "activity" || entryMode === "nutrition") ? <TextInput accessibilityLabel={entryMode === "activity" ? "活动描述" : "餐食描述"} value={activityType} onChangeText={setActivityType} placeholder={entryMode === "activity" ? "例如：下班后快走" : "例如：一碗面和鸡蛋"} placeholderTextColor={colors.ink3} style={styles.logInput} /> : null}
        {entryMode === "nutrition" ? <>
          <View style={styles.logQuickRow}>
            <Pressable accessibilityRole="radio" accessibilityState={{ selected: nutritionMode === "simplified" }} onPress={() => setNutritionMode("simplified")} style={[styles.logQuick, nutritionMode === "simplified" && styles.logQuickSelected]}><Text style={[styles.logQuickText, nutritionMode === "simplified" && styles.logQuickTextSelected]}>简单记录</Text></Pressable>
            <Pressable accessibilityRole="radio" accessibilityState={{ selected: nutritionMode === "precise" }} onPress={() => setNutritionMode("precise")} style={[styles.logQuick, nutritionMode === "precise" && styles.logQuickSelected]}><Text style={[styles.logQuickText, nutritionMode === "precise" && styles.logQuickTextSelected]}>精确输入</Text></Pressable>
          </View>
          {nutritionMode === "simplified" ? <>
            <NutritionChoice label="蛋白质" value={proteinCompletion} options={[{ value: "none", label: "未覆盖" }, { value: "partial", label: "部分" }, { value: "met", label: "达到" }]} onChange={setProteinCompletion} />
            <NutritionChoice label="饥饿感" value={hunger} options={[{ value: "low", label: "不明显" }, { value: "moderate", label: "一般" }, { value: "high", label: "明显" }]} onChange={setHunger} />
            <NutritionChoice label="与计划" value={deviation} options={[{ value: "none", label: "一致" }, { value: "small", label: "小偏差" }, { value: "large", label: "明显偏差" }]} onChange={setDeviation} />
          </> : <>
            <View style={styles.logQuickRow}>
              <Pressable accessibilityRole="radio" accessibilityState={{ selected: nutritionProvenance === "manual" }} onPress={() => setNutritionProvenance("manual")} style={[styles.logQuick, nutritionProvenance === "manual" && styles.logQuickSelected]}><Text style={[styles.logQuickText, nutritionProvenance === "manual" && styles.logQuickTextSelected]}>手动输入</Text></Pressable>
              <Pressable accessibilityRole="radio" accessibilityState={{ selected: nutritionProvenance === "label" }} onPress={() => setNutritionProvenance("label")} style={[styles.logQuick, nutritionProvenance === "label" && styles.logQuickSelected]}><Text style={[styles.logQuickText, nutritionProvenance === "label" && styles.logQuickTextSelected]}>标签数据</Text></Pressable>
            </View>
            <View style={styles.nutritionMetricGrid}>
              <NutritionMetricInput label="能量 kcal" value={energyKcal} onChange={setEnergyKcal} />
              <NutritionMetricInput label="蛋白质 g" value={proteinGrams} onChange={setProteinGrams} />
              <NutritionMetricInput label="脂肪 g" value={fatGrams} onChange={setFatGrams} />
              <NutritionMetricInput label="碳水 g" value={carbohydrateGrams} onChange={setCarbohydrateGrams} />
            </View>
          </>}
        </> : null}
        {entryMode === "activity" ? <View style={styles.logDuration}><Text style={styles.logLabel}>时长（分钟，可不填）</Text><TextInput accessibilityLabel="活动时长分钟" keyboardType="decimal-pad" value={durationMinutes} onChangeText={setDurationMinutes} placeholder="—" placeholderTextColor={colors.ink3} style={styles.logDurationInput} /></View> : null}
        {entryMode === "activity" ? <View style={styles.logQuickRow}>
          {[{ id: "easy", label: "轻松" }, { id: "moderate", label: "适中" }, { id: "hard", label: "吃力" }].map((option) => <Pressable key={option.id} accessibilityRole="radio" accessibilityState={{ selected: intensity === option.id }} onPress={() => setIntensity(option.id as typeof intensity)} style={[styles.logQuick, intensity === option.id && styles.logQuickSelected]}><Text style={[styles.logQuickText, intensity === option.id && styles.logQuickTextSelected]}>{option.label}</Text></Pressable>)}
        </View> : null}
        {entryMode === "sleep" ? <View style={styles.logDuration}><Text style={styles.logLabel}>睡眠时长（分钟）</Text><TextInput accessibilityLabel="睡眠时长分钟" keyboardType="decimal-pad" value={durationMinutes} onChangeText={setDurationMinutes} placeholder="例如 450" placeholderTextColor={colors.ink3} style={styles.logDurationInput} /></View> : null}
        {(entryMode === "sleep" || entryMode === "recovery") ? <View style={styles.logQuickRow}>{[{ value: "1", label: "很差" }, { value: "2", label: "偏低" }, { value: "3", label: "一般" }, { value: "4", label: "不错" }, { value: "5", label: "很好" }].map((option) => <Pressable key={option.value} accessibilityRole="radio" accessibilityState={{ selected: score === option.value }} onPress={() => setScore(option.value)} style={[styles.logQuick, score === option.value && styles.logQuickSelected]}><Text style={[styles.logQuickText, score === option.value && styles.logQuickTextSelected]}>{option.label}</Text></Pressable>)}</View> : null}
        {entryMode === "body" ? <><View style={styles.logQuickRow}><Pressable accessibilityRole="radio" accessibilityState={{ selected: bodyMetric === "body_weight" }} onPress={() => setBodyMetric("body_weight")} style={[styles.logQuick, bodyMetric === "body_weight" && styles.logQuickSelected]}><Text style={[styles.logQuickText, bodyMetric === "body_weight" && styles.logQuickTextSelected]}>体重</Text></Pressable><Pressable accessibilityRole="radio" accessibilityState={{ selected: bodyMetric === "body_fat_percentage" }} onPress={() => setBodyMetric("body_fat_percentage")} style={[styles.logQuick, bodyMetric === "body_fat_percentage" && styles.logQuickSelected]}><Text style={[styles.logQuickText, bodyMetric === "body_fat_percentage" && styles.logQuickTextSelected]}>体脂</Text></Pressable></View><View style={styles.logDuration}><Text style={styles.logLabel}>{bodyMetric === "body_weight" ? "体重（kg）" : "体脂率（%）"}</Text><TextInput accessibilityLabel={bodyMetric === "body_weight" ? "体重千克" : "体脂率"} keyboardType="decimal-pad" value={score} onChangeText={setScore} placeholder="—" placeholderTextColor={colors.ink3} style={styles.logDurationInput} /></View></> : null}
        {error ? <Text style={styles.formError}>{error}</Text> : null}
        <Pressable accessibilityRole="button" disabled={saving} onPress={() => void save()} style={[styles.logSave, saving && styles.primaryButtonDisabled]}><Text style={styles.logSaveText}>{saving ? "正在保存" : "保存记录"}</Text></Pressable>
      </ScrollView>
    </BottomDrawer>
  );
}

function NutritionChoice<T extends string>({ label, value, options, onChange }: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return <View style={styles.nutritionChoice}><Text style={styles.logLabel}>{label}</Text><View style={styles.logQuickRow}>{options.map((option) => <Pressable key={option.value} accessibilityRole="radio" accessibilityState={{ selected: value === option.value }} onPress={() => onChange(option.value)} style={[styles.logQuick, value === option.value && styles.logQuickSelected]}><Text style={[styles.logQuickText, value === option.value && styles.logQuickTextSelected]}>{option.label}</Text></Pressable>)}</View></View>;
}

function NutritionMetricInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <View style={styles.nutritionMetric}><Text style={styles.nutritionMetricLabel}>{label}</Text><TextInput accessibilityLabel={label} keyboardType="decimal-pad" value={value} onChangeText={onChange} placeholder="—" placeholderTextColor={colors.ink3} style={styles.nutritionMetricInput} /></View>;
}

function mealSlotForLabel(label: string): "breakfast" | "lunch" | "dinner" | "snack" {
  return label === "早餐" ? "breakfast" : label === "午餐" ? "lunch" : label === "晚餐" ? "dinner" : "snack";
}

function CalendarScreen(props: {
  screen: CoachProductProjection;
  onSelectDate: (date: string) => void;
  onPrevious: () => void;
  onNext: () => void;
  onToggleMode: () => void;
  onDateGestureActiveChange?: (active: boolean) => void;
  onDateGestureRegionChange?: (region: { top: number; bottom: number }) => void;
  onViewWorkoutSummary: (summary: WorkoutOutcomeProductSummary) => void;
  onCorrectTimeline: (entry: TimelineReadEvent) => void;
}) {
  const { calendar } = props.screen;
  const today = localDate();
  const hasSelectedRecords = calendar.selected.performedWorkouts.length > 0 || calendar.selected.activityLog.entries.length > 0;
  return (
    <ScrollView contentContainerStyle={[styles.content, styles.dockContent]} showsVerticalScrollIndicator={false}>
      <CalendarPager
        mode={calendar.mode}
        days={calendar.dates}
        selectedDate={calendar.selectedDate}
        today={today}
        planRange={props.screen.plan.horizon}
        locale={props.screen.profile.locale}
        onModeChange={() => props.onToggleMode()}
        onSelectDate={props.onSelectDate}
        onPrevious={props.onPrevious}
        onNext={props.onNext}
        onGestureActiveChange={props.onDateGestureActiveChange}
        onGestureRegionChange={props.onDateGestureRegionChange}
      />
      {hasSelectedRecords ? <PanelCard>
        <Text style={styles.cardEyebrow}>{weekdayAndDate(calendar.selected.date)}</Text>
        <Text style={styles.detailTitle}>{calendar.selected.date === today ? "今天做过的事" : "当天实际记录"}</Text>
        {calendar.selected.performedWorkouts.map((summary) => (
          <Pressable key={summary.id} accessibilityRole="button" accessibilityLabel={`查看 ${readablePlanSessionTitle(summary.title)} 的训练结果`} onPress={() => props.onViewWorkoutSummary(summary)} style={styles.performedWorkoutRow}>
            <View style={styles.performedWorkoutCopy}>
              <Text style={styles.performedWorkoutTitle}>{readablePlanSessionTitle(summary.title)}</Text>
              <Text style={styles.performedWorkoutMeta}>{outcomeStatusLabel(summary.status)} · {summary.completedWorkSets} 组完成 · {localDateTime(summary.completedAt).slice(-5)}</Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        ))}
        <Timeline entries={calendar.selected.activityLog.entries} compact onCorrect={props.onCorrectTimeline} />
      </PanelCard> : null}
    </ScrollView>
  );
}

type PlanWorkspaceTab = "overview" | "training" | "intake" | "trends";

function PlanScreen({ application, cloudConfirmed, userId, screen, initialTab, onOpenVideoLibrary, onRecordMeal, onUpdated }: { application: CoachApplication; cloudConfirmed: ConfirmedProductBridge; userId: string; screen: CoachProductProjection; initialTab: PlanWorkspaceTab; onOpenVideoLibrary: () => void; onRecordMeal: () => void; onUpdated: () => void }) {
  const { plan } = screen;
  const [activeTab, setActiveTab] = useState<PlanWorkspaceTab>(initialTab);
  const [managingExercises, setManagingExercises] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [previewOverride, setPreviewOverride] = useState<EvidenceBriefArtifact>();
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState<string>();
  const preview = previewOverride ?? plan.latestPlanningPreview;
  useEffect(() => {
    const trigger = preview?.planningPreview?.request.trigger;
    if (
      preview?.planningPreview?.status === "awaiting_confirmation"
      && (
        preview.planningPreview.proposal.planRevision.rollingEnergyAdjustment?.status === "gentle_rebalance"
        || trigger === "recovery_downgraded"
        || Boolean(preview.planningPreview.sourceRiskEvaluationId)
      )
    ) {
      setShowPreview(true);
    }
  }, [preview?.id, preview?.planningPreview?.status, preview?.planningPreview?.proposal.planRevision.rollingEnergyAdjustment?.status, preview?.planningPreview?.request.trigger]);
  const confirmPreview = async () => {
    if (!preview?.planningPreview || preview.planningPreview.status !== "awaiting_confirmation") return;
    setPreviewBusy(true);
    try {
      const domain = await application.readDomainProjection({ userId });
      await cloudConfirmed.publishPlanThen({
        localPlanId: screen.source.planId ?? preview.id,
        title: "MaxPower 训练计划",
        snapshot: createCloudPlanRecoverySnapshot({
          artifactId: preview.id,
          planningPreview: preview.planningPreview,
          domain,
        }),
        idempotencyKey: `mobile-plan-preview:${preview.id}`,
        commitLocal: () => application.confirmPlanningPreview({
          userId,
          previewId: preview.id,
          idempotencyKey: `mobile-plan-preview:confirm:${preview.id}`,
        }),
      });
      setPreviewOverride(undefined);
      setPreviewError(undefined);
      setShowPreview(false);
      onUpdated();
    } catch (cause) {
      setPreviewError(cause instanceof Error ? cause.message : "预览已变化，请重新计算");
    } finally {
      setPreviewBusy(false);
    }
  };
  const rejectPreview = async () => {
    if (!preview?.planningPreview || preview.planningPreview.status !== "awaiting_confirmation") return;
    setPreviewBusy(true);
    try {
      setPreviewOverride(await application.rejectPlanningPreview({ userId, previewId: preview.id, idempotencyKey: `mobile-plan-preview:reject:${preview.id}` }));
      setPreviewError(undefined);
      onUpdated();
    } catch (cause) {
      setPreviewError(cause instanceof Error ? cause.message : "暂时无法保存你的选择");
    } finally {
      setPreviewBusy(false);
    }
  };
  const recomputePreview = async () => {
    if (!preview?.planningPreview) return;
    setPreviewBusy(true);
    try {
      const next = await application.recomputePlanningPreview({
        userId,
        previewId: preview.id,
        // Each explicit retry is a new evaluation attempt. The resulting
        // artifact itself remains content-addressed, so unchanged facts still
        // deduplicate without freezing a prior failed attempt forever.
        idempotencyKey: `mobile-plan-preview:recompute:${preview.id}:${Date.now().toString(36)}`,
      });
      setPreviewOverride(next);
      setPreviewError(undefined);
    } catch (cause) {
      setPreviewError(cause instanceof Error ? cause.message : "暂时无法重新计算预览");
    } finally {
      setPreviewBusy(false);
    }
  };
  const requestRebuild = async () => {
    if (preview?.planningPreview && preview.planningPreview.status !== "confirmed") {
      setShowPreview(true);
      return;
    }
    setPreviewBusy(true);
    try {
      const next = await application.createPhaseTransitionPreview({
        userId,
        currentDate: localDate(),
        trigger: "user_requested",
        idempotencyKey: `mobile-plan-rebuild:${Date.now().toString(36)}`,
      });
      setPreviewOverride(next);
      setPreviewError(undefined);
      setShowPreview(true);
    } catch (cause) {
      setPreviewError(cause instanceof Error ? cause.message : "暂时无法建立重建预览");
    } finally {
      setPreviewBusy(false);
    }
  };
  return (
    <View style={styles.planPage}>
      <View style={styles.planFixedHeader}>
        <View style={styles.planTitleRow}>
          <View><Text style={styles.screenTitle}>计划与趋势</Text><Text style={styles.screenSub}>{plan.horizon ? `${shortDate(plan.horizon.startDate)}—${shortDate(plan.horizon.endDate)}` : "长期目标、当前行动与真实变化"}</Text></View>
          <View style={styles.planHeaderActions}><Pressable accessibilityRole="button" accessibilityLabel="重建计划" disabled={previewBusy} onPress={() => void requestRebuild()} style={styles.compactTextButton}><Text style={styles.compactTextButtonText}>{previewBusy ? "生成中" : "重建"}</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel="管理动作" onPress={() => setManagingExercises(true)} style={styles.compactTextButton}><Text style={styles.compactTextButtonText}>动作</Text></Pressable></View>
        </View>
        <SegmentedControl<PlanWorkspaceTab> compact value={activeTab} onChange={setActiveTab} options={[{ id: "overview", label: "概览" }, { id: "training", label: "训练" }, { id: "intake", label: "摄入" }, { id: "trends", label: "趋势" }]} />
      </View>
      <ScrollView key={activeTab} contentContainerStyle={styles.planTabContent} showsVerticalScrollIndicator={false}>
        {plan.status === "unavailable" ? <Empty label="完成建档后，这里会显示当前周期与本周安排。" /> : null}
        {plan.status === "stale" ? <Empty label="目标已更新，当前计划需要重新生成。" /> : null}
          {plan.status === "current" && activeTab === "overview" ? <PlanOverview screen={screen} preview={preview} onOpenTrends={() => setActiveTab("trends")} onOpenPreview={() => setShowPreview(true)} /> : null}
        {plan.status === "current" && activeTab === "training" ? <TrainingPlanTab plan={plan} locale={screen.profile.locale} /> : null}
        {plan.status === "current" && activeTab === "intake" ? <IntakePlanTab screen={screen} onRecordMeal={onRecordMeal} /> : null}
        {plan.status === "current" && activeTab === "trends" ? <PlanTrends screen={screen} onOpenVideoLibrary={onOpenVideoLibrary} /> : null}
      </ScrollView>
      {managingExercises ? <ExerciseManager application={application} userId={userId} onDismiss={() => setManagingExercises(false)} /> : null}
      <BottomDrawer visible={Boolean(showPreview && preview)} tall title={preview?.planningPreview?.request.trigger === "recovery_downgraded" ? "肩日调整预览" : preview?.planningPreview?.sourceRiskEvaluationId ? "进度风险调整预览" : "重建计划预览"} subtitle="确认前不会改变当前执行版本" onDismiss={() => setShowPreview(false)}>
        {preview ? <PlanningPreviewScreen preview={preview} nutritionStrategy={plan.nutritionTarget} busy={previewBusy} error={previewError} locale={screen.profile.locale} onConfirm={() => void confirmPreview()} onReject={() => void rejectPreview()} onRecompute={() => void recomputePreview()} /> : null}
      </BottomDrawer>
    </View>
  );
}

function PlanOverview({ screen, preview, onOpenTrends, onOpenPreview }: { screen: CoachProductProjection; preview?: EvidenceBriefArtifact; onOpenTrends(): void; onOpenPreview(): void }) {
  const { plan, progress, today } = screen;
  const locale = screen.profile.locale;
  const phase = progress.metrics.find((metric) => metric.name === "phase_progress");
  const trainingDays = plan.currentWeek.filter((session) => session.kind !== "rest" && session.kind !== "recovery" && session.taskCount > 0).length;
  const remaining = plan.horizon ? Math.max(0, dateDistance(localDate(), plan.horizon.endDate)) : undefined;
  const composite = progress.strengthTrends.composite.at(-1)?.index;
  return <>
    <View style={styles.cycleHero}>
      <View style={styles.reportCoverTop}><Text style={styles.reportKicker}>PLAN CYCLE / r{plan.revision ?? 0}</Text><View style={styles.reportStatus}><View style={styles.reportStatusDot} /><Text style={styles.reportStatusText}>执行中</Text></View></View>
      <Text style={styles.cycleHeroLabel}>当前方式</Text>
      <Text style={styles.cycleHeroTitle}>{strategyName(plan.strategySelection?.primary ?? "unknown", locale)}</Text>
      <Text style={styles.cycleHeroCopy}>{plan.horizon ? `${plan.horizon.startDate} → ${plan.horizon.endDate}` : "等待长期周期信息"}</Text>
      <View style={styles.cycleProgressRail}><View style={[styles.cycleProgressFill, { flex: Math.max(0.02, Math.min(1, phase?.value.score ?? 0)) }]} /><View style={{ flex: Math.max(0.001, 1 - Math.max(0.02, Math.min(1, phase?.value.score ?? 0))) }} /></View>
      <View style={styles.reportMetricGrid}><ReportMetric value={`${trainingDays} 天`} label="本周训练" /><ReportMetric value={remaining === undefined ? "—" : `${remaining} 天`} label="距周期结束" /><ReportMetric value={composite === undefined ? "待记录" : `${composite}`} label="三项指数" /></View>
    </View>

    {preview?.planningPreview && preview.planningPreview.status !== "confirmed" ? <Pressable accessibilityRole="button" accessibilityLabel="查看待确认的重建计划" onPress={onOpenPreview} style={styles.pendingPreviewCard}><View><Text style={styles.pendingPreviewKicker}>REBUILD READY</Text><Text style={styles.pendingPreviewTitle}>有一份重建预览等待处理</Text><Text style={styles.pendingPreviewMeta}>当前计划仍在执行，确认后才会切换版本。</Text></View><Text style={styles.pendingPreviewArrow}>›</Text></Pressable> : null}

    <SectionHeading title="当前行为" meta="建议与事实分开" />
    <View style={styles.behaviorGrid}>
      <BehaviorCard mark="T" title="训练" value={today.session ? readablePlanSessionTitle(today.session.title) : "恢复与日常活动"} meta={today.session ? sessionMeta(today.session) : "今天没有训练安排"} />
      <BehaviorCard mark="N" title="摄入" value={today.nutrition.budget.recommendedKcal === undefined ? "目标待建立" : `${today.nutrition.budget.recommendedKcal.toLocaleString()} kcal`} meta={intakeAdjustmentSummary(today.nutrition.budget)} />
      <BehaviorCard mark="R" title="恢复" value={recoveryLevelLabel(today.recovery.level)} meta={today.recovery.reasons.map((reason) => recoveryReasonLabel(reason, locale)).join("、") || "没有降低训练量的信号"} />
    </View>

    <Pressable accessibilityRole="button" accessibilityLabel="查看长期趋势" onPress={onOpenTrends} style={styles.trendEntryCard}>
      <View><Text style={styles.trendEntryKicker}>LONG VIEW</Text><Text style={styles.trendEntryTitle}>身体与力量趋势</Text><Text style={styles.trendEntryMeta}>体重、体脂、三大项与综合指数都在同一处查看。</Text></View><Text style={styles.trendEntryArrow}>↗</Text>
    </Pressable>
  </>;
}

function BehaviorCard({ mark, title, value, meta }: { mark: string; title: string; value: string; meta: string }) {
  return <PanelCard style={styles.behaviorCard}><View style={styles.behaviorTop}><Text style={styles.behaviorMark}>{mark}</Text><Text style={styles.behaviorTitle}>{title}</Text></View><Text style={styles.behaviorValue}>{value}</Text><Text style={styles.behaviorMeta}>{meta}</Text></PanelCard>;
}

function PlanTrends({ screen, onOpenVideoLibrary }: { screen: CoachProductProjection; onOpenVideoLibrary: () => void }) {
  const weight = screen.progress.bodyTrends.weight[0];
  const bodyFat = screen.progress.bodyTrends.bodyFat[0];
  const weightPoints = weight?.smoothedPoints.map((point) => ({ label: point.date, value: point.smoothedValue ?? point.value })) ?? [];
  const bodyFatPoints = bodyFat?.smoothedPoints.map((point) => ({ label: point.date, value: point.smoothedValue ?? point.value })) ?? [];
  const composite = screen.progress.strengthTrends.composite;
  return <>
    <SectionHeading title="身体趋势" meta="来自已确认记录" />
    <TrendChart title="体重" value={trendValue(weight?.smoothedPoints.at(-1)?.smoothedValue, weight?.rawPoints.at(-1)?.unit)} meta={trendCoverage(weight?.coverage.observations)} points={weightPoints} />
    <TrendChart title="体脂" value={trendValue(bodyFat?.smoothedPoints.at(-1)?.smoothedValue, bodyFat?.rawPoints.at(-1)?.unit)} meta={trendCoverage(bodyFat?.coverage.observations)} points={bodyFatPoints} color={uiColors.amber} />

    <SectionHeading title="力量趋势" meta="同一动作的可比记录" />
    {screen.progress.strengthTrends.lifts.map((lift) => <TrendChart key={lift.id} title={lift.label} value={lift.latestKg === undefined ? "—" : `${lift.latestKg} kg`} meta={lift.changePercent === undefined ? "等待至少两次可比记录" : `较起点 ${lift.changePercent >= 0 ? "+" : ""}${lift.changePercent}%`} points={lift.points.map((point) => ({ label: point.date, value: point.valueKg }))} />)}
    <TrendChart title="三大项综合指数" value={composite.length ? `${composite.at(-1)!.index}` : "—"} meta="三项起点合计 = 100" points={composite.map((point) => ({ label: point.date, value: point.index }))} color={uiColors.safe} />

    <SectionHeading title="行为判断" meta="用于复核，不替代原始记录" />
    <View style={styles.metricDecisionCard}>{screen.progress.metrics.map((metric, index) => <MetricDecisionRow key={metric.name} metric={metric} index={index + 1} />)}</View>
    <Pressable accessibilityRole="button" accessibilityLabel="打开训练视频" onPress={onOpenVideoLibrary} style={styles.videoLibraryCard}><View><Text style={styles.videoLibraryTitle}>训练视频与动作回放</Text><Text style={styles.videoLibraryMeta}>回看本机记录，并重新运行识别</Text></View><Text style={styles.videoLibraryArrow}>›</Text></Pressable>
    <SectionHeading title="时间线报告" meta={screen.progress.reportArtifacts.length ? `${screen.progress.reportArtifacts.length} 份` : "尚未生成"} />
    {screen.progress.reportArtifacts.length ? screen.progress.reportArtifacts.map((artifact) => <View key={artifact.id} style={styles.reportRow}><Text style={styles.reportTitle}>{artifact.kind === "weekly_coach_report" ? "每周回顾" : artifact.kind === "goal_forecast" ? "目标路径" : artifact.kind === "mesocycle_review" ? "周期回顾" : "计划复核"}</Text><Text style={styles.reportMeta}>{artifact.createdAt.slice(0, 10)}</Text></View>) : <Empty label="积累训练与生活记录后，这里会形成长期时间线。" />}
  </>;
}

function TrainingPlanTab({ plan, locale }: { plan: CoachProductProjection["plan"]; locale?: string }) {
  const currentTraining = plan.currentWeek.filter((session) => session.kind !== "rest" && session.kind !== "recovery" && session.taskCount > 0);
  const currentSets = currentTraining
    .filter((session) => session.kind === "weighted_reps" || session.kind === "bodyweight_reps")
    .reduce((sum, session) => sum + session.totalSetCount, 0);
  return <>
    {plan.strategySelection ? <View style={styles.committedPlanHero}>
      <View style={styles.reportCoverTop}><Text style={styles.reportKicker}>ACTIVE PROGRAM / r{plan.revision ?? 0}</Text><View style={styles.reportStatus}><View style={styles.reportStatusDot} /><Text style={styles.reportStatusText}>执行中</Text></View></View>
      <Text style={styles.reportCoverLabel}>当前训练阶段</Text>
      <Text style={styles.reportCoverTitle}>{strategyName(plan.strategySelection.primary, locale)}</Text>
      <Text style={styles.reportCoverCopy}>{planningPhrase(plan.appliedPhaseStrategy?.objective ?? "progress_with_recovery_budget", locale)}</Text>
      <View style={styles.reportMetricGrid}><ReportMetric value={`${currentTraining.length} 天`} label="本周训练" /><ReportMetric value={`${currentSets} 组`} label="工作组" /><ReportMetric value={plan.appliedPhaseStrategy ? shortDate(plan.appliedPhaseStrategy.reviewAt) : "每周"} label="下次复核" /></View>
    </View> : null}

    <ReportSectionHeading index="01" title="本周训练" subtitle="动作、组数和目标次数来自当前确认版本" />
    {plan.currentWeek.map((session) => <DetailedPlanSession key={session.id} session={session} />)}

    <ReportSectionHeading index="02" title="如何推进" subtitle="真实训练和恢复会决定下一次改什么" />
    <View style={styles.strategyStack}>
      <StrategyReportCard mark="T" title="负荷进阶" copy={planningPhrase(plan.trainingStrategy?.progression[0] ?? "compare_exact_variant_history_when_available", locale)} />
      <StrategyReportCard mark="R" title="恢复边界" copy={planningPhrase(plan.recoveryStrategy?.objective ?? "keep_daily_variation inside a safe next-session boundary", locale)} />
    </View>
    {plan.explanation ? <View style={styles.reportEvidenceCard}>{plan.explanation.userEvidence.map((item) => <ReportBullet key={item} text={planningPhrase(item, locale)} />)}{plan.explanation.ruleReason.map((item) => <ReportBullet key={item} text={planningPhrase(item, locale)} />)}{plan.explanation.uncertainty.map((item) => <ReportBullet key={item} text={planningPhrase(item, locale)} tone="unknown" />)}</View> : null}

    {plan.forecasts.length ? <><ReportSectionHeading index="03" title="推进路径" subtitle="不是承诺日期；记录趋势后会重新校准" /><View style={styles.forecastStack}>{plan.forecasts.map((forecast) => <View key={forecast.scenario} style={[styles.forecastReportCard, forecast.scenario === "balanced" && styles.forecastReportCardRecommended]}><View style={styles.forecastReportTop}><View><Text style={styles.forecastReportTitle}>{forecastName(forecast.scenario, locale)}</Text><Text style={styles.forecastReportEligibility}>{forecastEligibility(forecast.eligibility, locale)}</Text></View>{forecast.scenario === "balanced" ? <Text style={styles.forecastRecommended}>推荐</Text> : null}</View><Text style={styles.forecastReportDate}>{shortDate(forecast.earliest)}—{shortDate(forecast.latest)}</Text><Text style={styles.forecastReportMeta}>取舍：{forecast.tradeoffs.map((value) => planningPhrase(value, locale)).join("；")}</Text></View>)}</View></> : null}

    {plan.nextWeek.length ? <><ReportSectionHeading index="04" title="下一周预排" subtitle="会根据本周完成度和恢复状态更新" />{plan.nextWeek.map((session) => <DetailedPlanSession key={session.id} session={session} subdued />)}</> : null}
    {plan.futureIntentCount ? <Text style={styles.planFootnote}>后续 {plan.futureIntentCount} 项仍是周期意图，会在临近时物化。</Text> : null}
  </>;
}

function IntakePlanTab({ screen, onRecordMeal }: { screen: CoachProductProjection; onRecordMeal: () => void }) {
  const plan = screen.plan;
  const todayBudget = plan.intakeWeek.find((budget) => budget.date === screen.today.date) ?? screen.today.nutrition.budget;
  const palette = intakePalette(todayBudget.status);
  const explanation = intakeExplanation(todayBudget);
  const nutritionProtein = plan.nutritionTarget?.macronutrientTargets?.proteinGrams;
  const knownTargetDays = plan.intakeWeek.filter((budget) => budget.recommendedKcal !== undefined);
  const weeklyTarget = knownTargetDays.length === plan.intakeWeek.length
    ? knownTargetDays.reduce((sum, budget) => sum + (budget.recommendedKcal ?? 0), 0)
    : undefined;
  return <>
    <View style={styles.intakePlanHero}>
      <View style={styles.intakePlanHeroTop}>
        <View><Text style={[styles.cardEyebrow, styles.intakeEyebrow]}>TODAY / {shortDate(todayBudget.date)}</Text><Text style={styles.intakePlanHeroTitle}>今天该吃多少</Text></View>
        <View style={[styles.intakeStatusChip, { backgroundColor: palette.soft }]}><View style={[styles.intakeStatusDot, { backgroundColor: palette.color }]} /><Text style={[styles.intakeStatusChipText, { color: palette.ink }]}>{intakeStatusLabel(todayBudget)}</Text></View>
      </View>
      <View style={styles.intakePlanHeroMain}>
        <DailyFuelRing budget={todayBudget} size={154} />
        <View style={styles.intakePlanHeroNumbers}>
          <Text style={styles.intakeDayLabel}>{nutritionDayKindLabel(todayBudget.dayKind)}建议</Text>
          <Text style={styles.intakePlanTarget}>{todayBudget.recommendedKcal?.toLocaleString() ?? "—"}</Text>
          <Text style={styles.intakeTargetUnit}>kcal</Text>
          <Text style={styles.intakeTargetRange}>{todayBudget.recommendedRange ? `${todayBudget.recommendedRange.min.toLocaleString()}–${todayBudget.recommendedRange.max.toLocaleString()} 为正常区间` : "目标资料不足"}</Text>
        </View>
      </View>
      <View style={[styles.intakeExplanation, { backgroundColor: palette.soft, borderLeftColor: palette.color }]}><Text style={[styles.intakeExplanationTitle, { color: palette.ink }]}>{explanation.title}</Text><Text style={styles.intakeExplanationBody}>{explanation.body}</Text></View>
      <Pressable accessibilityRole="button" onPress={onRecordMeal} style={styles.intakePlanPrimary}><Text style={styles.intakePlanPrimaryText}>记录一餐</Text><View style={styles.intakePlanPrimaryArrow}><Text style={styles.intakePlanPrimaryArrowText}>＋</Text></View></Pressable>
    </View>

    <ReportSectionHeading index="01" title="本周摄入安排" subtitle={weeklyTarget === undefined ? "目标会跟随训练安排与已记录运动变化" : `本周建议总量约 ${weeklyTarget.toLocaleString()} kcal`} />
    <View style={styles.intakeWeekCard}>
      {plan.intakeWeek.map((budget) => <IntakeWeekRow key={budget.date} budget={budget} current={budget.date === screen.today.date} />)}
    </View>

    <ReportSectionHeading index="02" title="今天为什么是这个数" subtitle="训练多一点可以多补给，但不会按手表热量一比一返还" />
    <View style={styles.intakeBreakdownCard}>
      <IntakeBreakdownRow label="日均基础目标" detail={plan.nutritionTarget?.confidence === "provisional" ? "起始估算；14 天后用饮食与体重趋势校准" : "来自当前目标与已确认营养策略"} value={todayBudget.baseTargetKcal === undefined ? "待建立" : `${todayBudget.baseTargetKcal.toLocaleString()} kcal`} />
      <IntakeBreakdownRow label={todayBudget.dayKind === "training" ? "训练日分配" : todayBudget.dayKind === "rest" ? "休息日分配" : "当天类型分配"} detail="在一周总量附近重新分配" value={signedKcal(todayBudget.dayTypeAdjustmentKcal)} tone={todayBudget.dayTypeAdjustmentKcal > 0 ? "positive" : "neutral"} />
      <IntakeBreakdownRow label="已记录运动补给" detail={todayBudget.activityMinutes ? `${todayBudget.activityMinutes} 分钟 · 保守估算，最多加 200 kcal` : "记录额外运动后自动加入，最多 200 kcal"} value={signedKcal(todayBudget.activityAdjustmentKcal)} tone={todayBudget.activityAdjustmentKcal > 0 ? "positive" : "neutral"} />
      <View style={styles.intakeBreakdownTotal}><Text style={styles.intakeBreakdownTotalLabel}>今日建议</Text><Text style={styles.intakeBreakdownTotalValue}>{todayBudget.recommendedKcal === undefined ? "—" : `${todayBudget.recommendedKcal.toLocaleString()} kcal`}</Text></View>
    </View>

    <ReportSectionHeading index="03" title="不只看热量" subtitle="先稳定蛋白质和规律进餐，再判断周趋势" />
    <View style={styles.nutritionPrincipleCard}>
      <View style={styles.nutritionPrincipleLead}><Text style={styles.nutritionPrincipleValue}>{nutritionProtein ? `${nutritionProtein.min}–${nutritionProtein.max} g` : "待补资料"}</Text><Text style={styles.nutritionPrincipleLabel}>每日蛋白质目标</Text></View>
      <View style={styles.intakeSteps}>
        <IntakeStep index="1" title="正餐先安排蛋白质" detail={nutritionProtein ? `把 ${nutritionProtein.min}–${nutritionProtein.max} g 分到 3–4 餐，不必一餐补齐。` : "每餐先安排明确蛋白质来源；资料完整后再换算克数。"} />
        <IntakeStep index="2" title="训练日把更多能量放在训练前后" detail="额外预算优先支持训练表现与恢复，不意味着必须吃高糖零食。" />
        <IntakeStep index="3" title="不要用极端少吃补偿" detail="一次偏高看周趋势；长期明显偏低同样需要纠正，不是越少越好。" />
      </View>
      <Text style={styles.reportBoundary}>这里只统计已确认且量化的餐食。漏记会保持“未知”，不会制造虚假的低摄入结论。</Text>
    </View>
  </>;
}

function IntakeWeekRow({ budget, current }: { budget: DailyIntakeBudget; current: boolean }) {
  const palette = intakePalette(budget.status);
  const progress = clampNumber(budget.progressRatio ?? 0, 0, 1);
  return <View style={[styles.intakeWeekRow, current && styles.intakeWeekRowCurrent]}>
    <View style={[styles.intakeWeekDay, current && styles.intakeWeekDayCurrent]}><Text style={[styles.intakeWeekDayName, current && styles.intakeWeekDayNameCurrent]}>{current ? "今天" : weekDayLabel(budget.date)}</Text><Text style={[styles.intakeWeekDate, current && styles.intakeWeekDateCurrent]}>{budget.date.slice(5).replace("-", "/")}</Text></View>
    <View style={styles.intakeWeekBody}>
      <View style={styles.intakeWeekTop}><Text style={styles.intakeWeekKind}>{nutritionDayKindLabel(budget.dayKind)}</Text><Text style={styles.intakeWeekTarget}>{budget.recommendedKcal === undefined ? "待建立" : `${budget.recommendedKcal.toLocaleString()} kcal`}</Text></View>
      <View style={styles.intakeWeekProgress}><View style={[styles.intakeWeekProgressFill, { backgroundColor: palette.color, flex: progress }]} /><View style={{ flex: Math.max(0.001, 1 - progress) }} /></View>
      <View style={styles.intakeWeekBottom}><Text style={styles.intakeWeekConsumed}>{budget.consumedKcal === undefined ? "摄入待记录" : `已记录 ${budget.consumedKcal.toLocaleString()} kcal`}</Text><Text style={[styles.intakeWeekStatus, { color: palette.ink }]}>{intakeStatusLabel(budget)}</Text></View>
    </View>
  </View>;
}

function IntakeBreakdownRow({ label, detail, value, tone = "neutral" }: { label: string; detail: string; value: string; tone?: "positive" | "neutral" }) {
  return <View style={styles.intakeBreakdownRow}><View style={styles.intakeBreakdownBody}><Text style={styles.intakeBreakdownLabel}>{label}</Text><Text style={styles.intakeBreakdownDetail}>{detail}</Text></View><Text style={[styles.intakeBreakdownValue, tone === "positive" && styles.intakeBreakdownValuePositive]}>{value}</Text></View>;
}

const movementChoices: readonly { value: MovementPattern; label: string }[] = [
  { value: "horizontal_push", label: "水平推" },
  { value: "vertical_push", label: "垂直推" },
  { value: "horizontal_pull", label: "水平拉" },
  { value: "vertical_pull", label: "垂直拉" },
  { value: "squat", label: "深蹲" },
  { value: "hip_hinge", label: "髋铰链" },
  { value: "lunge", label: "弓步" },
  { value: "core_anti_extension", label: "核心" },
  { value: "locomotion", label: "移动" },
];

function ExerciseManager({ application, userId, onDismiss }: { application: CoachApplication; userId: string; onDismiss: () => void }) {
  const [exercises, setExercises] = useState<readonly CustomExerciseVariantView[]>();
  const [name, setName] = useState("");
  const [movement, setMovement] = useState<MovementPattern>();
  const [editing, setEditing] = useState<CustomExerciseVariantView>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const load = useCallback(async () => {
    try {
      setExercises(await application.listCustomExerciseVariants(userId));
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法读取自定义动作");
    }
  }, [application, userId]);
  useEffect(() => { void load(); }, [load]);
  const resetForm = () => {
    setName("");
    setMovement(undefined);
    setEditing(undefined);
  };
  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("请先填写动作名称。");
      return;
    }
    setBusy(true);
    try {
      if (editing) {
        await application.reviseCustomExerciseVariant({
          userId,
          customExerciseId: editing.id,
          expectedRevision: editing.revision,
          patch: { name: trimmed, movement: movement ?? null },
          idempotencyKey: `mobile-custom-exercise:${editing.id}:${editing.revision}:revise`,
        });
      } else {
        await application.createCustomExerciseVariant({
          userId,
          name: trimmed,
          ...(movement ? { movement } : {}),
          idempotencyKey: `mobile-custom-exercise:${Date.now().toString(36)}:create`,
        });
      }
      resetForm();
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法保存动作");
    } finally {
      setBusy(false);
    }
  };
  const archive = async (exercise: CustomExerciseVariantView) => {
    setBusy(true);
    try {
      await application.setCustomExerciseArchived({
        userId,
        customExerciseId: exercise.id,
        expectedRevision: exercise.revision,
        archived: true,
        idempotencyKey: `mobile-custom-exercise:${exercise.id}:${exercise.revision}:archive`,
      });
      if (editing?.id === exercise.id) resetForm();
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法归档动作");
    } finally {
      setBusy(false);
    }
  };
  const startEdit = (exercise: CustomExerciseVariantView) => {
    setEditing(exercise);
    setName(exercise.name);
    setMovement(exercise.movement);
    setError(undefined);
  };
  return (
    <View style={styles.exerciseManagerScrim}>
      <View style={styles.exerciseManagerSheet}>
        <View style={styles.sheetHandle} />
        <View style={styles.exerciseManagerHeader}>
          <View style={styles.exerciseManagerHeaderCopy}><Text style={styles.logTitle}>我的动作</Text><Text style={styles.exerciseManagerSub}>只管理你自己新增的动作；未知信息不会被当作训练事实。</Text></View>
          <Pressable accessibilityRole="button" accessibilityLabel="关闭动作管理" onPress={onDismiss} style={styles.exerciseClose}><Text style={styles.exerciseCloseText}>完成</Text></Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.exerciseManagerScroll} keyboardShouldPersistTaps="handled">
          {exercises === undefined ? <ActivityIndicator color={colors.limeDeep} /> : exercises.length ? exercises.map((exercise) => (
            <View key={exercise.id} style={styles.exerciseRow}>
              <View style={styles.exerciseRowBody}><Text style={styles.exerciseRowTitle}>{exercise.name}</Text><Text style={styles.exerciseRowMeta}>{movementLabel(exercise.movement)} · {exercise.prescriptionMode === "bodyweight_reps" ? "徒手次数" : exercise.prescriptionMode === "timed" ? "计时" : "重量 / 次数"}</Text></View>
              <Pressable accessibilityRole="button" accessibilityLabel={`编辑 ${exercise.name}`} disabled={busy} onPress={() => startEdit(exercise)} style={styles.exerciseInlineButton}><Text style={styles.exerciseInlineText}>编辑</Text></Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel={`归档 ${exercise.name}`} disabled={busy} onPress={() => void archive(exercise)} style={styles.exerciseInlineButton}><Text style={styles.exerciseArchiveText}>归档</Text></Pressable>
            </View>
          )) : <Text style={styles.exerciseEmpty}>还没有自定义动作。常用动作由本地知识包提供；这里适合记录你自己的器械或变式。</Text>}
          <View style={styles.exerciseForm}>
            <Text style={styles.exerciseFormTitle}>{editing ? "编辑动作" : "新增动作"}</Text>
            <TextInput accessibilityLabel="动作名称" value={name} onChangeText={setName} style={styles.logInput} placeholder="例如：健身房的坐姿划船机" placeholderTextColor="#777971" />
            <Text style={styles.exerciseFieldLabel}>动作模式（可留空）</Text>
            <View style={styles.logQuickRow}>{movementChoices.map((choice) => <Pressable key={choice.value} accessibilityRole="radio" accessibilityState={{ selected: movement === choice.value }} onPress={() => setMovement((current) => current === choice.value ? undefined : choice.value)} style={[styles.logQuick, movement === choice.value && styles.logQuickSelected]}><Text style={[styles.logQuickText, movement === choice.value && styles.logQuickTextSelected]}>{choice.label}</Text></Pressable>)}</View>
            {error ? <Text style={styles.formError}>{error}</Text> : null}
            <View style={styles.exerciseFormActions}>
              {editing ? <Pressable accessibilityRole="button" disabled={busy} onPress={resetForm} style={styles.exerciseCancel}><Text style={styles.exerciseCancelText}>取消</Text></Pressable> : null}
              <Pressable accessibilityRole="button" disabled={busy} onPress={() => void save()} style={[styles.logSave, styles.exerciseSave, busy && styles.primaryButtonDisabled]}><Text style={styles.logSaveText}>{busy ? "正在保存" : editing ? "保存修改" : "新增动作"}</Text></Pressable>
            </View>
          </View>
        </ScrollView>
      </View>
    </View>
  );
}

function ProgressScreen({ screen, onOpenVideoLibrary }: { screen: CoachProductProjection; onOpenVideoLibrary: () => void }) {
  const weight = screen.progress.bodyTrends.weight[0];
  const bodyFat = screen.progress.bodyTrends.bodyFat[0];
  const phase = screen.progress.metrics.find((metric) => metric.name === "phase_progress");
  const training = screen.progress.metrics.find((metric) => metric.name === "training_trend");
  return (
    <ScrollView contentContainerStyle={styles.progressContent} showsVerticalScrollIndicator={false}>
      <View style={styles.screenHeader}><View><Text style={styles.screenTitle}>进展</Text><Text style={styles.screenSub}>只用已确认记录判断趋势</Text></View></View>
      <View style={styles.progressHero}>
        <View style={styles.progressHeroTop}><Text style={styles.progressHeroKicker}>TRAINING RECORD</Text><Text style={styles.progressHeroPeriod}>当前阶段</Text></View>
        <View style={styles.progressHeroMain}><Text style={styles.progressHeroValue}>{screen.progress.completedWorkoutCount}</Text><View style={styles.progressHeroUnit}><Text style={styles.progressHeroUnitStrong}>次训练完成</Text><Text style={styles.progressHeroUnitSub}>每次结束后才计入</Text></View></View>
        <View style={styles.progressHeroFooter}><View><Text style={styles.progressHeroFooterLabel}>训练趋势</Text><Text style={styles.progressHeroFooterValue}>{training ? metricDirectionLabel(training.value.direction) : "待积累"}</Text></View><View><Text style={styles.progressHeroFooterLabel}>阶段进度</Text><Text style={styles.progressHeroFooterValue}>{phase?.value.score === undefined ? "待计算" : `${Math.round(phase.value.score * 100)}%`}</Text></View></View>
      </View>

      <View style={styles.editorialSectionHeader}><Text style={styles.editorialSectionTitle}>身体快照</Text><Text style={styles.editorialSectionMeta}>趋势，不是单点</Text></View>
      <View style={styles.bodySnapshotCard}>
        <BodyTrendRow label="体重" value={trendValue(weight?.smoothedPoints.at(-1)?.smoothedValue, weight?.rawPoints.at(-1)?.unit)} meta={trendCoverage(weight?.coverage.observations)} />
        <BodyTrendRow label="体脂" value={trendValue(bodyFat?.smoothedPoints.at(-1)?.smoothedValue, bodyFat?.rawPoints.at(-1)?.unit)} meta={trendCoverage(bodyFat?.coverage.observations)} />
      </View>

      <View style={styles.editorialSectionHeader}><Text style={styles.editorialSectionTitle}>六项判断</Text><Text style={styles.editorialSectionMeta}>Coach 决策依据</Text></View>
      <View style={styles.metricDecisionCard}>{screen.progress.metrics.map((metric, index) => <MetricDecisionRow key={metric.name} metric={metric} index={index + 1} />)}</View>

      <View style={styles.editorialSectionHeader}><Text style={styles.editorialSectionTitle}>训练视频</Text><Text style={styles.editorialSectionMeta}>仅保存在本机</Text></View>
      <Pressable accessibilityRole="button" accessibilityLabel="打开训练视频" onPress={onOpenVideoLibrary} style={styles.videoLibraryCard}>
        <View><Text style={styles.videoLibraryTitle}>本机视频库</Text><Text style={styles.videoLibraryMeta}>回放已录制的动作，并在本地重新识别</Text></View><Text style={styles.videoLibraryArrow}>›</Text>
      </Pressable>

      <View style={styles.editorialSectionHeader}><Text style={styles.editorialSectionTitle}>报告</Text><Text style={styles.editorialSectionMeta}>{screen.progress.reportArtifacts.length ? `${screen.progress.reportArtifacts.length} 份` : "尚未生成"}</Text></View>
      {screen.progress.reportArtifacts.length ? screen.progress.reportArtifacts.map((artifact) => (
        <View key={artifact.id} style={styles.reportRow}>
          <Text style={styles.reportTitle}>{artifact.kind === "weekly_coach_report" ? "每周回顾" : artifact.kind === "goal_forecast" ? "目标路径" : artifact.kind === "mesocycle_review" ? "周期回顾" : "计划复核"}</Text>
          <Text style={styles.reportMeta}>{artifact.createdAt.slice(0, 10)}</Text>
        </View>
      )) : <Empty label="积累一些训练与生活记录后，这里会出现趋势和报告。" />}
    </ScrollView>
  );
}

function BodyTrendRow({ label, value, meta }: { label: string; value: string; meta: string }) {
  return <View style={styles.bodyTrendRow}><View><Text style={styles.bodyTrendLabel}>{label}</Text><Text style={styles.bodyTrendMeta}>{meta}</Text></View><Text style={styles.bodyTrendValue}>{value}</Text></View>;
}

function MetricDecisionRow({ metric, index }: { metric: CoachProductProjection["progress"]["metrics"][number]; index: number }) {
  const color = metric.value.direction === "improving" ? colors.fuelSafe : metric.value.direction === "declining" ? colors.fuelDanger : metric.value.direction === "stable" ? colors.ink : colors.ink3;
  const score = metric.value.score === undefined ? 0 : clampNumber(Math.abs(metric.value.score), 0, 1);
  return <View style={styles.metricDecisionRow}>
    <Text style={styles.metricDecisionIndex}>{String(index).padStart(2, "0")}</Text>
    <View style={styles.metricDecisionBody}>
      <View style={styles.metricDecisionTop}><Text style={styles.metricDecisionTitle}>{metricLabel(metric.name)}</Text><Text style={[styles.metricDecisionValue, { color }]}>{metricDirectionLabel(metric.value.direction)}</Text></View>
      <View style={styles.metricDecisionRail}><View style={[styles.metricDecisionFill, { backgroundColor: color, flex: Math.max(0.02, score) }]} /><View style={{ flex: Math.max(0.001, 1 - Math.max(0.02, score)) }} /></View>
      <Text style={styles.metricDecisionMeta}>{metricConfidenceLabel(metric.confidence)} · {metric.comparableDays} 天可比</Text>
    </View>
  </View>;
}

function ProfileScreen({ application, userId, screen, onStartOnboarding, onOpenAccountSettings, onUpdated }: { application: CoachApplication; userId: string; screen: CoachProductProjection; onStartOnboarding: () => void; onOpenAccountSettings?: () => void; onUpdated: () => void }) {
  const profile = screen.profile;
  const [showPermissions, setShowPermissions] = useState(false);
  const [showPrivacyDetails, setShowPrivacyDetails] = useState(false);
  const [showActionLog, setShowActionLog] = useState(false);
  const [showCoachMemory, setShowCoachMemory] = useState(false);
  return (
    <ScrollView contentContainerStyle={[styles.content, styles.dockContent, styles.profileContent]} showsVerticalScrollIndicator={false}>
      {!profile.onboardingComplete ? <Pressable accessibilityRole="button" onPress={onStartOnboarding} style={styles.profileStart}><Text style={styles.profileStartText}>开始建档</Text></Pressable> : null}
      {profile.onboardingComplete ? <Pressable accessibilityRole="button" accessibilityLabel="打开个人档案" onPress={onStartOnboarding} style={({ pressed }) => [styles.profileHero, pressed && styles.cardPressed]}>
        <View style={styles.profileHeroTop}><Text style={styles.profileHeroKicker}>ATHLETE PROFILE</Text><Text style={styles.profileHeroStatus}>编辑档案 ↗</Text></View>
        <Text style={styles.profileHeroLabel}>当前主目标</Text><Text style={styles.profileHeroTitle}>{goalLabel(profile.primaryGoal)}</Text>
        <Text style={styles.profileHeroMeta}>{experienceLabel(profile.trainingExperience)} · Coach {mandateLabel(profile.mandateMode)}</Text>
        <View style={styles.profileHeroStats}><View style={styles.profileHeroStat}><Text style={styles.profileHeroStatValue}>{profile.locations}</Text><Text style={styles.profileHeroStatLabel}>训练地点</Text></View><View style={styles.profileHeroStat}><Text style={styles.profileHeroStatValue}>{profile.customExercises}</Text><Text style={styles.profileHeroStatLabel}>自定义动作</Text></View></View>
      </Pressable> : null}
      <Text style={styles.sectionTitle}>Coach 记忆</Text>
      <CoachMemoryPanel application={application} userId={userId} onOpen={() => setShowCoachMemory(true)} />
      <Text style={styles.sectionTitle}>权限</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="管理数据与权限" onPress={() => setShowPermissions(true)} style={[styles.profileCard, !profile.permissions && styles.profileSingleLineCard]}>
        {profile.permissions ? (
          <>
            <ProfileRow label="相机" value={permissionLabel(profile.permissions.camera)} />
            <ProfileRow label="健康数据" value={permissionLabel(profile.permissions.health)} />
            <ProfileRow label="通知" value={permissionLabel(profile.permissions.notifications)} />
            <ProfileRow label="照片分析" value={permissionLabel(profile.permissions.mediaUpload)} />
          </>
        ) : <Text style={styles.emptyText}>建档后可逐项选择授权。</Text>}
      </Pressable>
      <Text style={styles.sectionTitle}>账号与数据</Text>
      <PrivacySettingsPanel
        application={application}
        userId={userId}
        refreshKey={profile.permissions?.revision ?? 0}
        onOpenDetails={() => setShowPrivacyDetails(true)}
      />
      {onOpenAccountSettings ? <Pressable accessibilityRole="button" accessibilityLabel="打开登录与账号设置" onPress={onOpenAccountSettings} style={styles.profileLinkCard}><View><Text style={styles.profileLinkTitle}>登录与账号</Text><Text style={styles.profileLinkMeta}>登录方式、退出与账号删除</Text></View><Text style={styles.profileLinkArrow}>›</Text></Pressable> : null}
      <Text style={styles.sectionTitle}>健康数据</Text>
      <HealthConnectionPanel application={application} userId={userId} permissions={profile.permissions} sources={profile.healthSources} onUpdated={onUpdated} />
      <Text style={styles.sectionTitle}>Coach 提醒</Text>
      <RecipeReminderSettings application={application} userId={userId} onUpdated={onUpdated} />
      {profile.actionLog.recent.length ? <>
        <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>Coach 操作</Text><Pressable accessibilityRole="button" accessibilityLabel="查看全部 Coach 操作" onPress={() => setShowActionLog(true)}><Text style={styles.sectionLink}>查看全部</Text></Pressable></View>
        <View style={[styles.profileCard, styles.actionLogCard]}>
          {profile.actionLog.recent.map((entry, index) => <View key={entry.id} style={[styles.actionLogRow, index === profile.actionLog.recent.length - 1 && styles.actionLogRowLast]}><View style={styles.actionLogBody}><Text style={styles.actionLogTitle}>{actionLabel(entry.action)}</Text><Text style={styles.actionLogMeta}>{entry.actor === "agent" ? "Coach" : entry.actor === "rule_engine" ? "本地规则" : "你"} · {actionResultLabel(entry.result)} · {entry.occurredAt.slice(5, 16)}</Text></View></View>)}
        </View>
      </> : null}
      {showPermissions && profile.permissions ? <PermissionSettings application={application} userId={userId} permissions={profile.permissions} onDismiss={() => setShowPermissions(false)} onUpdated={() => { setShowPermissions(false); onUpdated(); }} /> : null}
      {showPrivacyDetails ? <PrivacySettingsSheet
        application={application}
        userId={userId}
        refreshKey={profile.permissions?.revision ?? 0}
        canManagePermissions={Boolean(profile.permissions)}
        onManagePermissions={() => { setShowPrivacyDetails(false); setShowPermissions(true); }}
        onDismiss={() => setShowPrivacyDetails(false)}
      /> : null}
      {showActionLog ? <ActionLogViewer application={application} userId={userId} onDismiss={() => setShowActionLog(false)} /> : null}
      {showCoachMemory ? <CoachMemorySheet application={application} userId={userId} onDismiss={() => setShowCoachMemory(false)} /> : null}
    </ScrollView>
  );
}

type PrivacySettingsOverviewValue = Awaited<ReturnType<CoachApplication["readPrivacySettingsOverview"]>>;

/** A compact status card; the full disclosure deliberately lives behind a tap. */
function PrivacySettingsPanel({ application, userId, refreshKey, onOpenDetails }: {
  application: CoachApplication;
  userId: string;
  refreshKey: number;
  onOpenDetails: () => void;
}) {
  const [overview, setOverview] = useState<PrivacySettingsOverviewValue>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let active = true;
    void application.readPrivacySettingsOverview({ userId }).then((next) => {
      if (active) {
        setOverview(next);
        setError(undefined);
      }
    }).catch(() => {
      if (active) setError("暂时无法读取数据使用状态");
    });
    return () => { active = false; };
  }, [application, refreshKey, userId]);
  if (!overview && !error) return <View style={[styles.profileCard, styles.privacySummaryLoading]}><ActivityIndicator color={colors.limeDeep} /></View>;
  if (error || !overview) return <Pressable accessibilityRole="button" accessibilityLabel="查看账号与数据" onPress={onOpenDetails} style={[styles.profileCard, styles.privacySummaryLoading]}><Text style={styles.emptyText}>{error ?? "查看数据使用"}</Text></Pressable>;
  return <Pressable accessibilityRole="button" accessibilityLabel="查看账号与数据" onPress={onOpenDetails} style={styles.profileCard}>
    <ProfileRow label="账号" value={privacyAccountLabel(overview)} />
    <ProfileRow label="同步" value={privacySyncLabel(overview)} />
    <ProfileRow label="远程模型" value={privacyRemoteModelLabel(overview)} />
    <View style={styles.privacySummaryFooter}><Text style={styles.privacySummaryFooterText}>{privacyMediaLabel(overview)}</Text><Text style={styles.sectionLink}>查看详情</Text></View>
  </Pressable>;
}

function PrivacySettingsSheet({ application, userId, refreshKey, canManagePermissions, onManagePermissions, onDismiss }: {
  application: CoachApplication;
  userId: string;
  refreshKey: number;
  canManagePermissions: boolean;
  onManagePermissions: () => void;
  onDismiss: () => void;
}) {
  const [overview, setOverview] = useState<PrivacySettingsOverviewValue>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let active = true;
    void application.readPrivacySettingsOverview({ userId }).then((next) => {
      if (active) {
        setOverview(next);
        setError(undefined);
      }
    }).catch(() => {
      if (active) setError("暂时无法读取数据使用状态");
    });
    return () => { active = false; };
  }, [application, refreshKey, userId]);
  return <BottomDrawer visible tall title="账号与数据" subtitle="账号、同步、云端 AI 与本机媒体" onDismiss={onDismiss}>
      {error ? <Text style={styles.formError}>{error}</Text> : overview === undefined ? <View style={styles.privacySheetLoading}><ActivityIndicator color={colors.limeDeep} /></View> : <ScrollView contentContainerStyle={styles.privacyDetailList} showsVerticalScrollIndicator={false}>
        <PrivacyDetailBlock title="账号" summary={privacyAccountLabel(overview)}>
          <Text style={styles.privacyDetailText}>{privacyAccountDetail(overview)}</Text>
        </PrivacyDetailBlock>
        <PrivacyDetailBlock title="同步" summary={privacySyncLabel(overview)}>
          <Text style={styles.privacyDetailText}>{privacySyncDetail(overview)}</Text>
        </PrivacyDetailBlock>
        <ReplicaSyncStatus application={application} userId={userId} refreshKey={refreshKey} />
        <PrivacyDetailBlock title="MaxPower 云端 AI" summary={privacyRemoteModelLabel(overview)}>
          <Text style={styles.privacyDetailText}>登录后，云端 AI 作为核心在线服务，为当前任务接收相关的{overview.remoteModel.consent.includedCategories.join("、")}语义。</Text>
          <Text style={styles.privacyDetailText}>发送前会移除{overview.remoteModel.consent.removedDirectIdentityFields.join("、")}。</Text>
          <Text style={styles.privacyDetailMeta}>服务由 {overview.remoteModel.configuration.service} 统一管理；客户端不保存或展示 Provider、物理模型与密钥。</Text>
          <Text style={styles.privacyDetailMeta}>该能力随登录自动启用；退出登录后停止使用。</Text>
        </PrivacyDetailBlock>
        <PrivacyDetailBlock title="本机媒体" summary={privacyMediaLabel(overview)}>
          <Text style={styles.privacyDetailText}>当前媒体只保留在本机，不会因为开启同步而自动上传。</Text>
          <Text style={styles.privacyDetailMeta}>{privacyMediaProtectionDetail(overview)}</Text>
        </PrivacyDetailBlock>
        {canManagePermissions ? <Pressable accessibilityRole="button" accessibilityLabel="管理数据授权" onPress={onManagePermissions} style={styles.privacyManageButton}><Text style={styles.privacyManageButtonText}>管理授权</Text></Pressable> : null}
      </ScrollView>}
  </BottomDrawer>;
}

function PrivacyDetailBlock({ title, summary, children }: { title: string; summary: string; children: React.ReactNode }) {
  return <View style={styles.privacyDetailBlock}><View style={styles.privacyDetailHeading}><Text style={styles.privacyDetailTitle}>{title}</Text><Text style={styles.privacyDetailSummary}>{summary}</Text></View>{children}</View>;
}

/**
 * Sync detail is deliberately read from the Facade rather than from the
 * privacy summary. It can expose local backlog and a user-initiated retry,
 * but not a cursor, remote payload, device identifier, or automatic branch
 * selection.
 */
function ReplicaSyncStatus({ application, userId, refreshKey }: {
  application: CoachApplication;
  userId: string;
  refreshKey: number;
}) {
  const [overview, setOverview] = useState<Awaited<ReturnType<CoachApplication["readReplicaSyncOverview"]>>>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setOverview(await application.readReplicaSyncOverview(userId));
      setError(undefined);
    } catch {
      setError("暂时无法读取同步状态");
    } finally {
      setLoading(false);
    }
  }, [application, userId]);
  useEffect(() => { void refresh(); }, [refresh, refreshKey]);

  const retry = async () => {
    setBusy(true);
    try {
      await application.synchronizeReplica(userId);
      await refresh();
    } catch {
      // Transport detail stays inside the internal audit. The user only needs
      // the current local state and a safe retry opportunity.
      setError("同步暂时未完成；本机资料仍可继续使用。");
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  if (loading && !overview) return <View style={styles.privacyDetailBlock}><Text style={styles.privacyDetailTitle}>同步详情</Text><ActivityIndicator color={colors.limeDeep} /></View>;
  if (!overview) return <View style={styles.privacyDetailBlock}><Text style={styles.privacyDetailTitle}>同步详情</Text><Text style={styles.privacyDetailText}>{error ?? "暂时无法读取同步状态"}</Text></View>;
  const presentation = presentReplicaSyncOverview(overview);
  return <View style={styles.privacyDetailBlock}>
    <View style={styles.privacyDetailHeading}><Text style={styles.privacyDetailTitle}>同步详情</Text><Text style={styles.privacyDetailSummary}>{presentation.label}</Text></View>
    <Text style={styles.privacyDetailText}>{presentation.detail}</Text>
    {overview.lastSucceededAt ? <Text style={styles.privacyDetailMeta}>最近完成于 {overview.lastSucceededAt.slice(0, 16).replace("T", " ")}</Text> : null}
    {presentation.conflicts.map((conflict) => <View key={`${conflict.label}:${conflict.detail}`} style={styles.replicaConflict}><Text style={styles.replicaConflictTitle}>{conflict.label}</Text><Text style={styles.privacyDetailMeta}>{conflict.detail}</Text></View>)}
    {error ? <Text style={styles.formError}>{error}</Text> : null}
    {presentation.canRetry && presentation.retryLabel ? <Pressable accessibilityRole="button" accessibilityLabel={presentation.retryLabel} disabled={busy} onPress={() => void retry()} style={[styles.replicaSyncButton, busy && styles.primaryButtonDisabled]}><Text style={styles.replicaSyncButtonText}>{busy ? "正在同步" : presentation.retryLabel}</Text></Pressable> : null}
  </View>;
}

const recipeReminderCopy: Readonly<Record<Exclude<import("../../coach/model").CoachRecipeKind, "fixed_reminder">, string>> = {
  session_completed_assessment: "训练完成后准备下一次训练",
  morning_check_in: "早晨的恢复记录提醒",
  recovery_changed: "恢复状态变化后的安排提醒",
  today_plan_changed: "今日安排发生变化",
  missed_session_review: "未完成训练后的安排提醒",
  schedule_or_equipment_changed: "场地或器材变化后的下一步",
  weekly_review: "每周训练与恢复回顾",
  deload_ended: "恢复周结束后的安排",
};

function RecipeReminderSettings({ application, userId, onUpdated }: { application: CoachApplication; userId: string; onUpdated: () => void }) {
  const [recipes, setRecipes] = useState<Awaited<ReturnType<CoachApplication["listCoachRecipes"]>>>();
  const [busyRecipeId, setBusyRecipeId] = useState<string>();
  const [error, setError] = useState<string>();
  const load = useCallback(async () => {
    await application.ensureDefaultEventRecipes(userId);
    setRecipes((await application.listCoachRecipes(userId)).filter((recipe) => recipe.kind !== "fixed_reminder"));
  }, [application, userId]);
  useEffect(() => { void load().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "无法读取提醒设置")); }, [load]);
  const toggle = async (recipe: NonNullable<typeof recipes>[number]) => {
    setBusyRecipeId(recipe.id);
    try {
      await application.updateEventRecipe({
        userId,
        recipeId: recipe.id,
        enabled: !recipe.enabled,
        notificationSettings: recipe.notificationSettings,
      });
      await load();
      onUpdated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法更新提醒设置");
    } finally {
      setBusyRecipeId(undefined);
    }
  };
  return <View style={[styles.profileCard, styles.reminderSettingsCard]}>
    <Text style={[styles.healthConnectionNote, styles.reminderSettingsIntro]}>这些是本机的提醒类别；系统通知权限与安静时段会在实际投递前再次生效。</Text>
    {recipes === undefined ? <ActivityIndicator color={colors.limeDeep} /> : recipes.map((recipe) => {
      const label = recipeReminderCopy[recipe.kind as keyof typeof recipeReminderCopy];
      return <View key={recipe.id} style={styles.permissionRow}><Text style={[styles.permissionTitle, { flex: 1 }]}>{label}</Text><Pressable accessibilityRole="switch" accessibilityLabel={`切换${label}`} accessibilityState={{ checked: recipe.enabled, disabled: busyRecipeId !== undefined }} disabled={busyRecipeId !== undefined} onPress={() => void toggle(recipe)} style={[styles.permissionSwitch, recipe.enabled && styles.permissionSwitchOn, busyRecipeId === recipe.id && styles.primaryButtonDisabled]}><View style={[styles.permissionKnob, recipe.enabled && styles.permissionKnobOn]} /></Pressable></View>;
    })}
    {error ? <Text style={styles.formError}>{error}</Text> : null}
  </View>;
}

const healthConnectionPlatform = Platform.OS === "ios" ? "healthkit" as const : "health_connect" as const;
const healthConnectionMetrics = healthConnectionPlatform === "healthkit"
  ? APPLE_HEALTHKIT_MVP_METRICS
  : ANDROID_HEALTH_CONNECT_MVP_METRICS;
const healthConnectionName = healthConnectionPlatform === "healthkit" ? "Apple 健康" : "Health Connect";

function HealthConnectionPanel({ application, userId, permissions, sources, onUpdated }: {
  application: CoachApplication;
  userId: string;
  permissions: CoachProductProjection["profile"]["permissions"];
  sources: CoachProductProjection["profile"]["healthSources"];
  onUpdated: () => void;
}) {
  const [connection, setConnection] = useState<Awaited<ReturnType<CoachApplication["getHealthConnectionState"]>>>();
  const [busy, setBusy] = useState<"permission" | "sync">();
  const [error, setError] = useState<string>();
  const refreshConnection = useCallback(async () => {
    try {
      setConnection(await application.getHealthConnectionState({ metricTypes: healthConnectionMetrics }));
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法读取健康数据连接状态");
    }
  }, [application]);
  useEffect(() => { void refreshConnection(); }, [refreshConnection]);

  const requestPermission = async () => {
    if (!permissions) return;
    setBusy("permission");
    try {
      await application.requestHealthConnectionPermissions({
        userId,
        metricTypes: healthConnectionMetrics,
        expectedPermissionRevision: permissions.revision,
        authorization: {
          kind: "local_user_presence",
          verifiedAt: new Date().toISOString(),
          nonce: `mobile-health-connect:${Date.now().toString(36)}`,
        },
        idempotencyKey: `mobile-health-connect-permission:${permissions.revision}:${Date.now().toString(36)}`,
      });
      await refreshConnection();
      onUpdated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `无法更新 ${healthConnectionName} 授权`);
    } finally {
      setBusy(undefined);
    }
  };

  const sync = async () => {
    setBusy("sync");
    try {
      await application.catchUpHealthEvidence({
        userId,
        platform: healthConnectionPlatform,
        metricTypes: healthConnectionMetrics,
        idempotencyKeyPrefix: `mobile-health-connect-import:${Date.now().toString(36)}`,
        adapterSchemaVersion: healthConnectionPlatform === "health_connect" ? "android-health-connect-v1" : "ios-healthkit-v1",
      });
      await refreshConnection();
      onUpdated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `暂时无法同步 ${healthConnectionName}`);
    } finally {
      setBusy(undefined);
    }
  };

  const availability = connection?.availability;
  const grants = connection ? Object.values(connection.permissionByMetric).filter((value) => value === "granted" || value === "unknown").length : 0;
  const canRequest = Boolean(permissions) && (availability === "permission_not_requested" || availability === "permission_denied_or_revoked" || availability === "available");
  const canSync = availability === "available" && grants > 0;
  return <View style={[styles.profileCard, styles.healthConnectionCard]}>
    <View style={styles.healthConnectionTop}>
      <View style={{ flex: 1 }}><Text style={styles.healthConnectionTitle}>{healthConnectionName}</Text><Text style={styles.healthConnectionMeta}>{connection ? healthConnectionStatus(connection.availability, grants, healthConnectionName) : "正在检查本机支持情况"}</Text></View>
      {busy ? <ActivityIndicator color={colors.limeDeep} /> : null}
    </View>
    <Text style={styles.healthConnectionNote}>{healthConnectionPlatform === "healthkit" ? "睡眠、SDNN、静息心率、已完成活动、体重和体脂可分别请求读取。Apple 不会公开逐项读取授权；无样本不会被解释为没有记录。" : "睡眠、RMSSD、静息心率、已完成活动、体重和体脂可分别授权；未授权时仍可手动记录。"}</Text>
    {sources.length ? <View style={styles.healthImportedList}>{sources.map((source) => <ProfileRow key={source.platform} label={healthSourceLabel(source.platform)} value={healthSourceSummary(source)} />)}</View> : null}
    {error ? <Text style={styles.formError}>{error}</Text> : null}
    {!permissions ? <Text style={styles.healthConnectionMeta}>完成建档后可以选择连接。</Text> : <View style={styles.healthConnectionActions}>
      {canRequest ? <Pressable accessibilityRole="button" disabled={busy !== undefined} onPress={() => void requestPermission()} style={[styles.healthConnectionPrimary, busy && styles.primaryButtonDisabled]}><Text style={styles.healthConnectionPrimaryText}>{availability === "permission_denied_or_revoked" ? "重新授权" : "选择读取范围"}</Text></Pressable> : null}
      {canSync ? <Pressable accessibilityRole="button" disabled={busy !== undefined} onPress={() => void sync()} style={[styles.healthConnectionSecondary, busy && styles.primaryButtonDisabled]}><Text style={styles.healthConnectionSecondaryText}>同步更新</Text></Pressable> : null}
    </View>}
  </View>;
}

function ActionLogViewer({ application, userId, onDismiss }: { application: CoachApplication; userId: string; onDismiss: () => void }) {
  const [events, setEvents] = useState<Awaited<ReturnType<CoachApplication["listActionLog"]>>>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    void application.listActionLog(userId).then(setEvents).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : "无法读取操作日志");
    });
  }, [application, userId]);
  return <View style={styles.actionLogScrim}><View style={styles.actionLogSheet}><View style={styles.sheetHandle} /><View style={styles.exerciseManagerHeader}><View style={styles.exerciseManagerHeaderCopy}><Text style={styles.logTitle}>Coach 操作</Text><Text style={styles.exerciseManagerSub}>这是操作轨迹，不是你的训练 Timeline。撤销会保留原记录并创建补偿版本。</Text></View><Pressable accessibilityRole="button" accessibilityLabel="关闭 Coach 操作" onPress={onDismiss} style={styles.exerciseClose}><Text style={styles.exerciseCloseText}>完成</Text></Pressable></View><ScrollView contentContainerStyle={styles.actionLogList}>{error ? <Text style={styles.formError}>{error}</Text> : events === undefined ? <ActivityIndicator color={colors.limeDeep} /> : events.length ? events.map((event) => <View key={event.id} style={styles.actionLogDetailRow}><View style={styles.actionLogDetailTop}><Text style={styles.actionLogTitle}>{actionLabel(event.action)}</Text><Text style={styles.actionLogResult}>{actionResultLabel(event.result)}</Text></View><Text style={styles.actionLogDetailMeta}>{actorLabel(event.actor)} · {event.occurredAt.slice(0, 16).replace("T", " ")}</Text><Text style={styles.actionLogIntent}>{event.intent}</Text>{event.beforeRevision !== undefined || event.afterRevision !== undefined ? <Text style={styles.actionLogDetailMeta}>版本 {event.beforeRevision ?? "—"} → {event.afterRevision ?? "—"}</Text> : null}{event.reversible && !event.undoneBy ? <Text style={styles.actionLogReversible}>可通过原卡片撤销</Text> : null}</View>) : <Text style={styles.exerciseEmpty}>还没有记录。实际训练、饮食和恢复会在 Timeline 中查看。</Text>}</ScrollView></View></View>;
}

type CoachMemoryItem = Awaited<ReturnType<CoachApplication["listMemory"]>>[number];
type CoachMemoryKind = CoachMemoryItem["kind"];

const coachMemoryKinds: readonly { value: CoachMemoryKind; label: string }[] = [
  { value: "preference", label: "偏好" },
  { value: "focus", label: "当前重点" },
  { value: "strategy_note", label: "策略备注" },
  { value: "open_question", label: "待确认" },
  { value: "hypothesis", label: "待验证" },
];

function CoachMemoryPanel({ application, userId, onOpen }: { application: CoachApplication; userId: string; onOpen: () => void }) {
  const [items, setItems] = useState<readonly CoachMemoryItem[]>();
  useEffect(() => {
    let active = true;
    void application.listMemory(userId).then((next) => { if (active) setItems(next); }).catch(() => { if (active) setItems([]); });
    return () => { active = false; };
  }, [application, userId]);
  const pinned = items?.filter((item) => item.pinned).length ?? 0;
  return <Pressable accessibilityRole="button" accessibilityLabel="管理 Coach 记忆" onPress={onOpen} style={[styles.profileCard, styles.profileSummaryCard]}>
    <View style={styles.privacySummaryFooter}>
      <View style={styles.profileSummaryCopy}><Text style={styles.profileLabel}>本机备忘</Text><Text style={styles.exerciseManagerSub}>不会自动改写资料、Timeline 或计划</Text></View>
      <Text style={styles.sectionLink}>{items === undefined ? "查看" : `${items.length} 条${pinned ? ` · 已固定 ${pinned}` : ""}`}</Text>
    </View>
  </Pressable>;
}

function CoachMemorySheet({ application, userId, onDismiss }: { application: CoachApplication; userId: string; onDismiss: () => void }) {
  const [items, setItems] = useState<readonly CoachMemoryItem[]>();
  const [editing, setEditing] = useState<CoachMemoryItem>();
  const [content, setContent] = useState("");
  const [kind, setKind] = useState<CoachMemoryKind>("preference");
  const [sensitivity, setSensitivity] = useState<"normal" | "private">("normal");
  const [pinned, setPinned] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const refresh = useCallback(async () => {
    try {
      setItems(await application.listMemory(userId));
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法读取 Coach 记忆");
    }
  }, [application, userId]);
  useEffect(() => { void refresh(); }, [refresh]);
  const resetEditor = () => {
    setEditing(undefined); setContent(""); setKind("preference"); setSensitivity("normal"); setPinned(false); setError(undefined);
  };
  const edit = (item: CoachMemoryItem) => {
    setEditing(item); setContent(item.content); setKind(item.kind); setSensitivity(item.sensitivity); setPinned(item.pinned); setError(undefined);
  };
  const save = async () => {
    if (!content.trim()) { setError("先写下希望 Coach 记住的内容。"); return; }
    setBusy(true);
    try {
      await application.upsertMemory({
        userId,
        actor: "user",
        ...(editing ? { id: editing.id, expectedVersion: editing.version, evidenceRefs: editing.evidenceRefs } : { evidenceRefs: [] }),
        kind,
        content,
        confidence: editing?.confidence ?? 1,
        sensitivity,
        pinned,
        idempotencyKey: `mobile-memory:${editing?.id ?? "new"}:${editing?.version ?? 0}:${Date.now().toString(36)}`,
      });
      resetEditor();
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法保存 Coach 记忆");
    } finally { setBusy(false); }
  };
  const togglePin = async (item: CoachMemoryItem) => {
    setBusy(true);
    try { await application.setMemoryPinned({ userId, id: item.id, expectedVersion: item.version, pinned: !item.pinned }); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "无法更新固定状态"); }
    finally { setBusy(false); }
  };
  const forget = async (item: CoachMemoryItem) => {
    setBusy(true);
    try { await application.forgetMemory({ userId, id: item.id, expectedVersion: item.version }); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "无法删除 Coach 记忆"); }
    finally { setBusy(false); }
  };
  return <View accessibilityViewIsModal style={styles.permissionScrim}>
    <View style={coachMemoryStyles.sheet}>
      <View style={styles.sheetHandle} />
      <View style={styles.exerciseManagerHeader}><View style={styles.exerciseManagerHeaderCopy}><Text style={styles.logTitle}>Coach 记忆</Text><Text style={styles.exerciseManagerSub}>这是可管理的本机备忘，不是你的档案、真实经历或自动执行指令。</Text></View><Pressable accessibilityRole="button" accessibilityLabel="关闭 Coach 记忆" onPress={onDismiss} style={styles.exerciseClose}><Text style={styles.exerciseCloseText}>完成</Text></Pressable></View>
      <ScrollView contentContainerStyle={coachMemoryStyles.body} keyboardShouldPersistTaps="handled">
        <View style={coachMemoryStyles.editor}>
          <Text style={coachMemoryStyles.editorTitle}>{editing ? "编辑备忘" : "添加备忘"}</Text>
          <View style={coachMemoryStyles.kindRow}>{coachMemoryKinds.map((candidate) => <Pressable key={candidate.value} accessibilityRole="radio" accessibilityState={{ selected: kind === candidate.value }} onPress={() => setKind(candidate.value)} style={[coachMemoryStyles.kindChip, kind === candidate.value && coachMemoryStyles.kindChipSelected]}><Text style={[coachMemoryStyles.kindText, kind === candidate.value && coachMemoryStyles.kindTextSelected]}>{candidate.label}</Text></Pressable>)}</View>
          <TextInput accessibilityLabel="Coach 记忆内容" value={content} onChangeText={setContent} multiline maxLength={1000} placeholder="例如：周末更适合在上午训练" placeholderTextColor={colors.ink3} style={coachMemoryStyles.input} />
          <View style={coachMemoryStyles.optionRow}><Pressable accessibilityRole="checkbox" accessibilityState={{ checked: pinned }} onPress={() => setPinned((value) => !value)} style={coachMemoryStyles.option}><Text style={coachMemoryStyles.optionMark}>{pinned ? "✓" : "○"}</Text><Text style={coachMemoryStyles.optionText}>固定，Coach 不可覆盖</Text></Pressable><Pressable accessibilityRole="checkbox" accessibilityState={{ checked: sensitivity === "private" }} onPress={() => setSensitivity((value) => value === "private" ? "normal" : "private")} style={coachMemoryStyles.option}><Text style={coachMemoryStyles.optionMark}>{sensitivity === "private" ? "✓" : "○"}</Text><Text style={coachMemoryStyles.optionText}>仅本机私密</Text></Pressable></View>
          {error ? <Text style={styles.formError}>{error}</Text> : null}
          <View style={coachMemoryStyles.editorActions}>{editing ? <Pressable accessibilityRole="button" onPress={resetEditor} style={coachMemoryStyles.cancel}><Text style={coachMemoryStyles.cancelText}>取消编辑</Text></Pressable> : null}<Pressable accessibilityRole="button" disabled={busy} onPress={() => void save()} style={[coachMemoryStyles.save, busy && styles.primaryButtonDisabled]}><Text style={coachMemoryStyles.saveText}>{editing ? "保存修改" : "保存备忘"}</Text></Pressable></View>
        </View>
        <Text style={coachMemoryStyles.listTitle}>已保存</Text>
        {items === undefined ? <ActivityIndicator color={colors.limeDeep} /> : items.length ? items.map((item) => <View key={item.id} style={coachMemoryStyles.item}><View style={coachMemoryStyles.itemHead}><Text style={coachMemoryStyles.itemKind}>{coachMemoryKinds.find((candidate) => candidate.value === item.kind)?.label ?? item.kind}</Text><Text style={coachMemoryStyles.itemMeta}>{item.pinned ? "已固定" : item.provenance.actor === "agent" ? "Coach 整理" : "你记录"}{item.sensitivity === "private" ? " · 私密" : ""}</Text></View><Text style={coachMemoryStyles.itemContent}>{item.content}</Text><View style={coachMemoryStyles.itemActions}><Pressable accessibilityRole="button" disabled={busy} onPress={() => edit(item)}><Text style={coachMemoryStyles.itemActionText}>编辑</Text></Pressable><Pressable accessibilityRole="button" disabled={busy} onPress={() => void togglePin(item)}><Text style={coachMemoryStyles.itemActionText}>{item.pinned ? "取消固定" : "固定"}</Text></Pressable><Pressable accessibilityRole="button" disabled={busy} onPress={() => void forget(item)}><Text style={coachMemoryStyles.deleteText}>删除</Text></Pressable></View></View>) : <Text style={styles.emptyText}>还没有备忘。需要时可以把偏好、当前重点或待确认的问题写在这里。</Text>}
      </ScrollView>
    </View>
  </View>;
}

const coachMemoryStyles = StyleSheet.create({
  sheet: { maxHeight: "86%", backgroundColor: colors.paper, borderTopLeftRadius: 30, borderTopRightRadius: 30, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 28 },
  body: { gap: 12, paddingBottom: 12 },
  editor: { backgroundColor: colors.white, borderRadius: radius.card, padding: 14, gap: 10 },
  editorTitle: { color: colors.ink, fontSize: 15, fontWeight: "900" },
  kindRow: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  kindChip: { minHeight: 32, borderRadius: radius.chip, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 11, justifyContent: "center" },
  kindChipSelected: { borderColor: colors.limeDeep, backgroundColor: "#EEF9C7" },
  kindText: { color: colors.ink2, fontSize: 12, fontWeight: "800" }, kindTextSelected: { color: colors.limeInk },
  input: { minHeight: 84, borderRadius: 12, backgroundColor: colors.paper2, color: colors.ink, paddingHorizontal: 12, paddingVertical: 10, textAlignVertical: "top", fontSize: 14 },
  optionRow: { flexDirection: "row", flexWrap: "wrap", gap: 12 }, option: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 32 }, optionMark: { color: colors.limeInk, fontSize: 16, fontWeight: "900" }, optionText: { color: colors.ink2, fontSize: 12, fontWeight: "700" },
  editorActions: { flexDirection: "row", justifyContent: "flex-end", gap: 8 }, cancel: { minHeight: 40, borderRadius: radius.chip, paddingHorizontal: 14, justifyContent: "center" }, cancelText: { color: colors.ink2, fontSize: 13, fontWeight: "800" }, save: { minHeight: 40, borderRadius: radius.chip, backgroundColor: colors.dark, paddingHorizontal: 16, justifyContent: "center" }, saveText: { color: colors.lime, fontSize: 13, fontWeight: "900" },
  listTitle: { color: colors.ink, fontSize: 15, fontWeight: "900", marginTop: 2 }, item: { backgroundColor: colors.white, borderRadius: radius.row, padding: 14, gap: 7 }, itemHead: { flexDirection: "row", justifyContent: "space-between", gap: 10 }, itemKind: { color: colors.limeInk, fontSize: 12, fontWeight: "900" }, itemMeta: { color: colors.ink3, fontSize: 11 }, itemContent: { color: colors.ink, fontSize: 14, lineHeight: 20 }, itemActions: { flexDirection: "row", gap: 16, marginTop: 2 }, itemActionText: { color: colors.ink2, fontSize: 12, fontWeight: "800" }, deleteText: { color: colors.terra, fontSize: 12, fontWeight: "800" },
});

type PermissionSettingsValue = NonNullable<CoachProductProjection["profile"]["permissions"]>;
type PermissionSettingsKey = Exclude<keyof PermissionSettingsValue, "revision" | "id" | "remoteLlmDisclosure" | "remoteLlm" | "cloudSync">;

const permissionSettings: readonly { key: PermissionSettingsKey; label: string; description: string }[] = [
  { key: "camera", label: "相机", description: "只在你主动进入监控或录像时再请求系统相机权限。" },
  { key: "health", label: "健康数据", description: "可连接系统健康数据；拒绝后仍能手动记录。" },
  { key: "notifications", label: "提醒", description: "用于本地训练与恢复提醒；系统通知权限会单独确认。" },
  { key: "mediaUpload", label: "照片分析", description: "每次发送食物图片前都会让你确认；识别结果先是草稿。" },
];

function PermissionSettings({ application, userId, permissions, onDismiss, onUpdated }: { application: CoachApplication; userId: string; permissions: PermissionSettingsValue; onDismiss: () => void; onUpdated: () => void }) {
  const [busy, setBusy] = useState<PermissionSettingsKey>();
  const [error, setError] = useState<string>();
  const setPermission = async (key: PermissionSettingsKey, value: "granted" | "denied") => {
    setBusy(key);
    let updated = false;
    try {
      await application.updatePermissionFromSettings({
        userId,
        expectedRevision: permissions.revision,
        changes: { [key]: value },
        authorization: {
          kind: "local_user_presence",
          verifiedAt: new Date().toISOString(),
          nonce: `mobile-permission:${key}:${Date.now().toString(36)}`,
        },
        idempotencyKey: `mobile-permission:${key}:${permissions.revision}:${value}`,
      });
      updated = true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法更新本地授权");
    } finally {
      setBusy(undefined);
    }
    if (updated) onUpdated();
  };
  const toggle = (key: PermissionSettingsKey, enabled: boolean) => {
    void setPermission(key, enabled ? "denied" : "granted");
  };
  return (
    <View style={styles.permissionScrim}>
      <View style={styles.permissionSheet}>
        <View style={styles.sheetHandle} />
        <View style={styles.exerciseManagerHeader}><View style={styles.exerciseManagerHeaderCopy}><Text style={styles.logTitle}>数据与权限</Text><Text style={styles.exerciseManagerSub}>本地授权独立保存。真正启用设备能力时，系统仍会按需再次确认。</Text></View><Pressable accessibilityRole="button" accessibilityLabel="关闭数据与权限" onPress={onDismiss} style={styles.exerciseClose}><Text style={styles.exerciseCloseText}>完成</Text></Pressable></View>
        <ScrollView contentContainerStyle={styles.permissionList}>
          {permissionSettings.map((setting) => {
            const value = permissions[setting.key];
            const enabled = value === "granted";
            return <View key={setting.key} style={styles.permissionRow}><View style={styles.permissionBody}><Text style={styles.permissionTitle}>{setting.label}</Text><Text style={styles.permissionDescription}>{setting.description}</Text></View><Pressable accessibilityRole="switch" accessibilityState={{ checked: enabled, disabled: busy !== undefined }} disabled={busy !== undefined} onPress={() => toggle(setting.key, enabled)} style={[styles.permissionSwitch, enabled && styles.permissionSwitchOn, busy === setting.key && styles.primaryButtonDisabled]}><View style={[styles.permissionKnob, enabled && styles.permissionKnobOn]} /></Pressable></View>;
          })}
          {error ? <Text style={styles.formError}>{error}</Text> : null}
        </ScrollView>
      </View>
    </View>
  );
}

function OnboardingScreen({ application, cloudConfirmed, userId, entry, messages, onSendConversation, onStartConversation, onAllowRemoteConversation, onCompleted, onProgressSaved }: { application: CoachApplication; cloudConfirmed: ConfirmedProductBridge; userId: string; entry?: OnboardingEntryState; messages: readonly CoachMessage[]; onSendConversation: (text: string, draftId: string) => Promise<void>; onStartConversation: (draftId: string) => Promise<void>; onAllowRemoteConversation: (draftId: string) => Promise<void>; onCompleted: () => void; onProgressSaved: () => void }) {
  const [baselineIntake, setBaselineIntake] = useState<BaselineIntakeValues>({ ...EMPTY_BASELINE_INTAKE });
  const [baselineSubmitted, setBaselineSubmitted] = useState(false);
  const [baselineSaving, setBaselineSaving] = useState(false);
  const [dynamicCard, setDynamicCard] = useState<DynamicFormCard>();
  const [dynamicValues, setDynamicValues] = useState<DynamicOnboardingFormValues>();
  const [dynamicUnknownFields, setDynamicUnknownFields] = useState<ReadonlySet<string>>(new Set());
  const [dynamicLoading, setDynamicLoading] = useState(false);
  const [dynamicSaving, setDynamicSaving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const onboardingDraftId = useRef<string | undefined>(entry?.draft?.id);
  const dynamicRequestFrontier = useRef<string>();
  const [dossierSummary, setDossierSummary] = useState<import("../../onboarding").OnboardingDossierSummary>();
  const [firstPlan, setFirstPlan] = useState<FirstPlannerHandoffProposal>();
  const [conversationText, setConversationText] = useState("");
  const [conversationSending, setConversationSending] = useState(false);
  const [remotePermissionNeeded, setRemotePermissionNeeded] = useState(false);
  const latestAssessment = entry?.draft?.coachingLevelAssessments?.at(-1);
  const assessmentHasEvidence = Boolean(
    latestAssessment && Object.values(latestAssessment.dimensions).some((dimension) => dimension.supportingEvidence.length > 0),
  );
  useEffect(() => {
    if (entry?.draft?.id) onboardingDraftId.current = entry.draft.id;
  }, [entry?.draft?.id]);
  useEffect(() => {
    const baseline = entry?.draft?.patch.baseline;
    if (!baseline) return;
    setBaselineIntake({
      ageYears: baseline.age ? String(baseline.age.ageYears) : "",
      heightCm: baseline.height ? String(baseline.height.value.value) : "",
      currentWeightKg: baseline.currentWeight ? String(baseline.currentWeight.value.value) : "",
      goalNarrative: baseline.goalNarrative?.text ?? "",
    });
    if (entry.draft.baselineMissingFields.length === 0) setBaselineSubmitted(true);
  }, [entry]);
  useEffect(() => {
    const draft = entry?.draft;
    const requestFrontier = draft ? `${draft.id}:${draft.revision}` : undefined;
    if (!draft || draft.baselineMissingFields.length > 0 || dynamicCard || dynamicLoading || dynamicRequestFrontier.current === requestFrontier) return;
    dynamicRequestFrontier.current = requestFrontier;
    setDynamicLoading(true);
    void application.readActiveOnboardingDynamicForm({ draftId: draft.id }).then((card) => {
      if (!card) return;
      setDynamicCard(card);
      setDynamicValues(createDynamicOnboardingFormValues(card));
      setDynamicUnknownFields(new Set());
    }).catch((cause) => {
      setError(cause instanceof Error ? cause.message : "暂时没能准备好下一步。请再试一次。");
    }).finally(() => setDynamicLoading(false));
  }, [application, dynamicCard, dynamicLoading, entry]);
  const saveBaseline = async (values: BaselineIntakeValues) => {
    const observedAt = new Date().toISOString();
    const submissionId = `baseline-card:${userId}:${observedAt}`;
    setBaselineSaving(true);
    setError(undefined);
    try {
      const draft = await application.startOrResumeBaselineIntake({ userId });
      onboardingDraftId.current = draft.id;
      await application.saveBaselineIntake({
        draftId: draft.id,
        inputMode: "form",
        idempotencyKey: submissionId,
        values: {
          age: { ageYears: Number(values.ageYears.trim()), observedAt, source: { kind: "form_submission", submissionId } },
          height: { value: { value: Number(values.heightCm.trim()), unit: "cm" }, observedAt, source: { kind: "form_submission", submissionId } },
          currentWeight: { value: { value: Number(values.currentWeightKg.trim()), unit: "kg" }, observedAt, source: { kind: "form_submission", submissionId } },
          goalNarrative: { text: values.goalNarrative.trim(), observedAt, source: { kind: "form_submission", submissionId } },
        },
      });
      setBaselineSubmitted(true);
      try {
        await onStartConversation(draft.id);
      } catch (cause) {
        if (cause instanceof Error && cause.message === "remote_llm_permission_required") {
          setRemotePermissionNeeded(true);
        } else {
          throw cause;
        }
      }
      onProgressSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "这几个信息还需要再确认一下。");
    } finally {
      setBaselineSaving(false);
    }
  };
  const sendOnboardingConversation = async () => {
    const draftId = entry?.draft?.id ?? onboardingDraftId.current;
    const text = conversationText.trim();
    if (!draftId || !text) return;
    setConversationSending(true);
    setError(undefined);
    try {
      await onSendConversation(text, draftId);
      setConversationText("");
      onProgressSaved();
    } catch (cause) {
      if (cause instanceof Error && cause.message === "remote_llm_permission_required") {
        setRemotePermissionNeeded(true);
      } else {
        setError(cause instanceof Error ? cause.message : "这段话暂时没能写入对话。请再试一次。");
      }
    } finally {
      setConversationSending(false);
    }
  };
  const allowRemoteConversation = async () => {
    const draftId = entry?.draft?.id ?? onboardingDraftId.current;
    if (!draftId) return;
    setConversationSending(true);
    setError(undefined);
    try {
      await onAllowRemoteConversation(draftId);
      setRemotePermissionNeeded(false);
      await onStartConversation(draftId);
      onProgressSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "暂时没能开启这段对话。请再试一次。");
    } finally {
      setConversationSending(false);
    }
  };
  const submitDynamicCard = async (values: DynamicOnboardingFormValues) => {
    if (!dynamicCard) return;
    setDynamicSaving(true);
    setError(undefined);
    try {
      const answers: DynamicFormAnswer[] = dynamicCard.fieldIds.map((fieldId) => dynamicUnknownFields.has(fieldId)
        ? { fieldId, state: "explicit_unknown" }
        : { fieldId, state: "captured_explicit", value: dynamicFormValueToDomain(values[fieldId]) });
      await application.submitOnboardingDynamicForm({
        draftId: entry?.draft?.id ?? onboardingDraftId.current ?? "",
        cardId: dynamicCard.cardId,
        expectedDraftRevision: dynamicCard.draftRevision,
        answers,
        idempotencyKey: `mobile-onboarding:${dynamicCard.cardId}:submit`,
      });
      setDynamicCard(undefined);
      setDynamicValues(undefined);
      setDynamicUnknownFields(new Set());
      onProgressSaved();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "这组信息还需要再确认一下。";
      setError(message);
      if (message === "stale_dynamic_form") {
        setDynamicCard(undefined);
        setDynamicValues(undefined);
        setDynamicUnknownFields(new Set());
        onProgressSaved();
      }
    } finally {
      setDynamicSaving(false);
    }
  };
  const prepareDossierConfirmation = async () => {
    const draftId = entry?.draft?.id ?? onboardingDraftId.current;
    if (!draftId) return;
    setSaving(true);
    setError(undefined);
    try {
      setDossierSummary(await application.readOnboardingDossierSummary({ draftId }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "暂时无法整理档案。");
    } finally {
      setSaving(false);
    }
  };
  const confirmDossier = async () => {
    if (!dossierSummary) return;
    setSaving(true);
    setError(undefined);
    try {
      const staged = await application.stageOnboardingDossierConfirmation({
        userId,
        draftId: dossierSummary.draftId,
        expectedDraftRevision: dossierSummary.draftRevision,
        expectedFactFrontier: dossierSummary.confirmation.factFrontier,
        idempotencyKey: `mobile-onboarding:${dossierSummary.draftId}:confirm-dossier`,
      });
      await cloudConfirmed.patchProfileThen({
        patch: { data: createCloudProfileRecoverySnapshot(staged.domain) },
        idempotencyKey: `mobile-onboarding:${dossierSummary.draftId}:profile-recovery`,
        commitLocal: () => staged.commitAcknowledged(),
      });
      const handoff = await application.createFirstPlannerHandoff({
        userId,
        draftId: dossierSummary.draftId,
        currentDate: localDate(),
        idempotencyKey: `mobile-onboarding:${dossierSummary.draftId}:first-plan`,
      });
      setDossierSummary(undefined);
      setFirstPlan(handoff);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "档案有更新，请重新确认。");
      setDossierSummary(undefined);
      onProgressSaved();
    } finally {
      setSaving(false);
    }
  };
  const confirmFirstPlan = async () => {
    if (!firstPlan || firstPlan.status !== "awaiting_confirmation") return;
    setSaving(true);
    setError(undefined);
    try {
      await application.confirmFirstPlannerHandoff({
        userId,
        proposalId: firstPlan.id,
        idempotencyKey: `mobile-onboarding:${firstPlan.id}:confirm`,
      });
      onCompleted();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "计划已变化，请重新检查。");
    } finally {
      setSaving(false);
    }
  };
  if (!baselineSubmitted) {
    return <ScrollView contentContainerStyle={styles.onboardingContent} showsVerticalScrollIndicator={false}>
      <View style={styles.onboardingHero}>
        <View style={styles.onboardingHeroTop}><Text style={styles.onboardingKicker}>从这里开始</Text><Text style={styles.onboardingStep}>01</Text></View>
        <Text style={styles.onboardingHeroTitle}>说说你现在{`\n`}和想去的地方。</Text>
        <Text style={styles.onboardingHeroCopy}>先给我四个基本信息。接下来我会按你的目标继续了解，不让你填一长串问卷。</Text>
        <View style={styles.onboardingProgress}><View style={styles.onboardingProgressOn} /><View style={styles.onboardingProgressOff} /></View>
      </View>
      <BaselineIntakeCard
        value={baselineIntake}
        disabled={baselineSaving}
        onChange={(field, value) => setBaselineIntake((current) => ({ ...current, [field]: value }))}
        onContinue={(value) => void saveBaseline(value)}
      />
      {error ? <Text style={styles.formError}>{error}</Text> : null}
    </ScrollView>;
  }
  if (baselineSubmitted && !dossierSummary && !firstPlan) {
    return <ScrollView contentContainerStyle={styles.onboardingContent} showsVerticalScrollIndicator={false}>
      <View style={styles.onboardingHero}>
        <View style={styles.onboardingHeroTop}><Text style={styles.onboardingKicker}>已记下</Text><Text style={styles.onboardingStep}>02</Text></View>
        <Text style={styles.onboardingHeroTitle}>这就够开始了。</Text>
        <Text style={styles.onboardingHeroCopy}>我会先根据你的目标整理下一步真正需要了解的内容；已经说过的，不会再让你重复回答。</Text>
      </View>
      {remotePermissionNeeded ? <View style={styles.quickChoiceCard}>
        <Text style={styles.quickChoiceTitle}>继续前，确认是否使用联网对话。</Text>
        <Text style={styles.quickChoiceHint}>联网时会把建立档案所需的训练、目标和基础身体信息发给对话服务；不包含姓名或联系方式。</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="允许使用联网对话并继续" disabled={conversationSending} onPress={() => void allowRemoteConversation()} style={[styles.onboardingButton, conversationSending && styles.primaryButtonDisabled]}><Text style={styles.onboardingButtonText}>{conversationSending ? "正在开启…" : "允许并继续"}</Text><Text style={styles.onboardingButtonArrow}>→</Text></Pressable>
      </View> : dynamicCard && dynamicValues ? <DynamicOnboardingFormCard
        card={dynamicCard}
        value={dynamicValues}
        disabled={dynamicSaving}
        onChange={(fieldId, value) => {
          setDynamicUnknownFields((current) => {
            const next = new Set(current);
            next.delete(fieldId);
            return next;
          });
          setDynamicValues((current) => current ? updateDynamicOnboardingFormValue(dynamicCard, current, fieldId, value) : current);
        }}
        onExplicitUnknown={(fieldId) => setDynamicUnknownFields((current) => new Set([...current, fieldId]))}
        onSubmit={(values) => void submitDynamicCard(values)}
      /> : <View style={styles.quickChoiceCard}>
        <Text style={styles.quickChoiceTitle}>{dynamicLoading ? "我在整理下一步。" : "接下来继续这一段对话。"}</Text>
        {messages.slice(-3).map((message) => <Text key={message.id} style={styles.quickChoiceHint}>{message.role === "assistant" ? "我：" : "你："}{message.content}</Text>)}
        <TextInput accessibilityLabel="补充你的训练情况" value={conversationText} onChangeText={setConversationText} editable={!conversationSending} multiline placeholder="比如：我练了两年，一周四练，最近胸背腿肩，健身房训练。" placeholderTextColor={colors.ink3} style={styles.onboardingInput} />
        <Pressable accessibilityRole="button" accessibilityLabel="发送建档对话" disabled={conversationSending || !conversationText.trim()} onPress={() => void sendOnboardingConversation()} style={[styles.onboardingButton, (conversationSending || !conversationText.trim()) && styles.primaryButtonDisabled]}><Text style={styles.onboardingButtonText}>{conversationSending ? "正在整理…" : "继续"}</Text><Text style={styles.onboardingButtonArrow}>→</Text></Pressable>
      </View>}
      {!remotePermissionNeeded && !dynamicCard && !dynamicLoading && assessmentHasEvidence ? <Pressable accessibilityRole="button" accessibilityLabel="查看档案摘要" disabled={saving} onPress={() => void prepareDossierConfirmation()} style={[styles.onboardingButton, saving && styles.primaryButtonDisabled]}><Text style={styles.onboardingButtonText}>{saving ? "正在整理…" : "查看档案摘要"}</Text><Text style={styles.onboardingButtonArrow}>→</Text></Pressable> : null}
      {!remotePermissionNeeded && !dynamicCard && !dynamicLoading && !assessmentHasEvidence ? <Text style={styles.quickChoiceHint}>我还需要从你的描述里确认一点训练背景，才会整理档案；不会用默认等级替代。</Text> : null}
      {error ? <Text style={styles.formError}>{error}</Text> : null}
    </ScrollView>;
  }
  if (dossierSummary) return (
    <ScrollView contentContainerStyle={styles.onboardingContent} showsVerticalScrollIndicator={false}>
      <View style={styles.onboardingHero}><View style={styles.onboardingHeroTop}><Text style={styles.onboardingKicker}>确认档案</Text><Text style={styles.onboardingStep}>03</Text></View><Text style={styles.onboardingHeroTitle}>这是我目前理解的你。</Text><Text style={styles.onboardingHeroCopy}>确认后才会建立正式档案；训练计划仍会单独交给你确认。</Text></View>
      <View style={styles.quickChoiceCard}>
        <Text style={styles.quickChoiceTitle}>{dossierSummary.userFacts.baseline?.goalNarrative?.text}</Text>
        <Text style={styles.quickChoiceHint}>年龄 {dossierSummary.userFacts.baseline?.age?.ageYears} · 身高 {dossierSummary.userFacts.baseline?.height?.value.value} cm · 体重 {dossierSummary.userFacts.baseline?.currentWeight?.value.value} kg</Text>
        {dossierSummary.trainingBackground?.recentSplit?.length ? <Text style={styles.quickChoiceHint}>近期训练：{dossierSummary.trainingBackground.recentSplit.join(" / ")}</Text> : null}
        <Text style={styles.quickChoiceHint}>训练评估：{dossierSummary.coachingLevelAssessment ? "已根据你的训练记录整理，仍可继续校准" : "还没有足够记录，不会替你判断水平"}</Text>
        <Text style={styles.quickChoiceHint}>当前状态：{dossierSummary.readiness.status === "active" ? "可以按受影响部位调整训练" : dossierSummary.readiness.status === "unassessed" ? "尚未做当日恢复确认" : "恢复信息需要更新"}</Text>
        <Text style={styles.quickChoiceHint}>安全状态：{dossierSummary.safety.status === "restricted" ? "有活动限制，会先保守处理" : dossierSummary.safety.status === "stop_signal" ? "需暂停并寻求专业帮助" : dossierSummary.safety.status === "explicitly_unknown" ? "限制情况暂不确定" : "尚未声明限制"}</Text>
        <Text style={styles.quickChoiceHint}>调整方式：{dossierSummary.authorization.mandate?.mode === "manual" ? "所有计划变化先由你确认" : "尚未设置"}</Text>
        {Object.values(dossierSummary.userFacts.dynamicFields ?? {}).filter((field) => field.state === "normalized_needs_review").map((field) => <Text key={field.fieldId} style={styles.quickChoiceHint}>待你确认：{field.fieldId} · {typeof field.value === "string" ? field.value : JSON.stringify(field.value)}</Text>)}
        {dossierSummary.unknowns.length ? <Text style={styles.quickChoiceHint}>暂未确认：{dossierSummary.unknowns.join("、")}</Text> : null}
        {dossierSummary.limitedActions.length ? <Text style={styles.quickChoiceHint}>暂不自动处理：{dossierSummary.limitedActions.join("、")}</Text> : null}
      </View>
      {error ? <Text style={styles.formError}>{error}</Text> : null}
      <Pressable accessibilityRole="button" accessibilityLabel="确认我的档案" disabled={saving} onPress={() => void confirmDossier()} style={[styles.onboardingButton, saving && styles.primaryButtonDisabled]}><Text style={styles.onboardingButtonText}>{saving ? "正在保存档案…" : "确认我的档案"}</Text><Text style={styles.onboardingButtonArrow}>→</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="返回继续修改档案" disabled={saving} onPress={() => setDossierSummary(undefined)} style={styles.previewRejectButton}><Text style={styles.previewRejectText}>返回继续修改</Text></Pressable>
    </ScrollView>
  );
  if (firstPlan) return (
    <ScrollView contentContainerStyle={styles.onboardingContent} showsVerticalScrollIndicator={false}>
      <View style={styles.onboardingHero}>
        <View style={styles.onboardingHeroTop}><Text style={styles.onboardingKicker}>首次计划</Text><Text style={styles.onboardingStep}>04</Text></View>
        <Text style={styles.onboardingHeroTitle}>{firstPlan.status === "needs_input" ? "先校准，不猜。" : "这是第一版安排。"}</Text>
        <Text style={styles.onboardingHeroCopy}>{firstPlan.status === "needs_input" ? "还缺少会改变训练安排的信息。补齐后再给你第一版，不会用默认水平代替。" : "这是可执行的起点。确认后才会成为你的活动计划，之后会按记录和恢复继续调整。"}</Text>
      </View>
      {firstPlan.status === "needs_input" ? <View style={styles.quickChoiceCard}>
        <Text style={styles.quickChoiceTitle}>还需要确认</Text>
        {firstPlan.needsInput.map((item) => <Text key={item} style={styles.quickChoiceHint}>· {item}</Text>)}
      </View> : <View style={styles.quickChoiceCard}>
        <Text style={styles.quickChoiceTitle}>{firstPlan.plan?.title ?? "首次训练计划"}</Text>
        {firstPlan.plan?.week.sessions.map((session) => <Text key={session.id} style={styles.quickChoiceHint}>{session.focus} · {session.exercises.length} 个动作</Text>)}
        {firstPlan.unknowns.length ? <Text style={styles.quickChoiceHint}>仍待校准：{firstPlan.unknowns.join("、")}</Text> : null}
      </View>}
      {error ? <Text style={styles.formError}>{error}</Text> : null}
      {firstPlan.status === "awaiting_confirmation" ? <Pressable accessibilityRole="button" accessibilityLabel="确认首次训练计划" disabled={saving} onPress={() => void confirmFirstPlan()} style={[styles.onboardingButton, saving && styles.primaryButtonDisabled]}><Text style={styles.onboardingButtonText}>{saving ? "正在确认…" : "确认这版计划"}</Text><Text style={styles.onboardingButtonArrow}>→</Text></Pressable> : <Pressable accessibilityRole="button" accessibilityLabel="返回补充信息" disabled={saving} onPress={() => { const draftId = entry?.draft?.id ?? onboardingDraftId.current; setFirstPlan(undefined); if (draftId) void onStartConversation(draftId).then(onProgressSaved).catch((cause) => setError(cause instanceof Error ? cause.message : "暂时没能继续这段对话。")); }} style={styles.previewRejectButton}><Text style={styles.previewRejectText}>返回补充信息</Text></Pressable>}
    </ScrollView>
  );
}

function PlanningPreviewScreen({ preview, nutritionStrategy, busy, error, locale, onConfirm, onReject, onRecompute }: {
  preview: EvidenceBriefArtifact;
  nutritionStrategy?: NutritionStrategyData;
  busy: boolean;
  error?: string;
  /** From profile.locale; falls back to English when unknown. */
  locale?: string;
  onConfirm?: () => void;
  onReject?: () => void;
  onRecompute: () => void;
}) {
  const proposal = preview.planningPreview?.proposal;
  if (!proposal) {
    return <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.screenHeader}><View><Text style={styles.screenTitle}>计划预览</Text><Text style={styles.screenSub}>当前事实不足以安全生成路线</Text></View></View>
      <View style={styles.detailCard}><Text style={styles.detailTitle}>先保留未知</Text>{preview.summary.map((item) => <Text key={item} style={styles.detailMeta}>{item}</Text>)}<Text style={styles.planFootnote}>不会用猜测填入训练能力、重量或维护热量。</Text></View>
      {error ? <Text style={styles.formError}>{error}</Text> : null}
      <Pressable accessibilityRole="button" disabled={busy} onPress={onRecompute} style={[styles.primaryButton, busy && styles.primaryButtonDisabled]}><Text style={styles.primaryButtonText}>重新检查</Text></Pressable>
    </ScrollView>;
  }
  const phase = proposal.appliedPhaseStrategy;
  const report = buildPlanningReportSummary(proposal, locale);
  const firstWeek = proposal.planRevision.materializedWeeks?.[0];
  const trainingSessions = firstWeek?.sessions.filter((session) => session.kind !== "rest" && session.tasks.length > 0) ?? [];
  const strengthBaselineNeedsSetContext = proposal.missing.includes("strength_baseline_missing_reps_rir");
  const protein = nutritionStrategy?.macronutrientTargets?.proteinGrams;
  const hasProteinTarget = Boolean(protein && protein.max > 0);
  const energyRange = nutritionStrategy?.calorieRange;
  const rollingEnergy = proposal.planRevision.rollingEnergyAdjustment;
  const recoveryAdjustment = preview.planningPreview?.request.trigger === "recovery_downgraded";
  const riskAdjustment = Boolean(preview.planningPreview?.sourceRiskEvaluationId);
  const recoverySession = recoveryAdjustment ? trainingSessions[0] : undefined;
  const recoveryFirstSet = recoverySession?.tasks.flatMap((task) => task.sets)[0];
  const rebalanceIsEstimate = rollingEnergy?.surplusSource === "description_estimate" || rollingEnergy?.surplusSource === "mixed";
  const rebalanceRange = rollingEnergy?.estimatedSurplusRangeKcal;
  const rebalanceActionKcal = rollingEnergy?.plannedAdditionalExpenditureKcal ?? 0;
  const rebalanceRemainingKcal = rollingEnergy?.remainingSurplusKcal ?? 0;
  const firstRebalanceAction = rollingEnergy?.actions[0];
  const rebalanceActivityText = firstRebalanceAction
    ? firstRebalanceAction.extraLowImpactCardioMinutes > 0
      ? `每次增加 ${firstRebalanceAction.extraLowImpactCardioMinutes} 分钟快走，并多走 ${firstRebalanceAction.extraSteps} 步`
      : `课程已占满，不强塞有氧；在恢复正常时多走 ${firstRebalanceAction.extraSteps} 步`
    : "当前没有可安全增加的活动时段";
  return <ScrollView contentContainerStyle={styles.reportContent} showsVerticalScrollIndicator={false}>
    <View style={styles.reportCover}>
      <View style={styles.reportCoverTop}><Text style={styles.reportKicker}>MAXPOWER / TRAINING BRIEF</Text><View style={styles.reportStatus}><View style={styles.reportStatusDot} /><Text style={styles.reportStatusText}>{preview.planningPreview?.status === "awaiting_confirmation" ? "待确认" : preview.planningPreview?.status === "stale" ? "需重算" : "未启用"}</Text></View></View>
      <Text style={styles.reportCoverLabel}>{recoveryAdjustment ? "下一次训练调整" : riskAdjustment ? "根据最新记录的未来调整" : "你的起始路线"}</Text>
      <Text style={styles.reportCoverTitle}>{recoveryAdjustment ? "保守肩日" : riskAdjustment ? "把计划拉回目标路径" : strategyName(proposal.strategySelection?.primary ?? "unknown", locale)}</Text>
      <Text style={styles.reportCoverCopy}>{recoveryAdjustment ? "睡眠欠佳、腿部仍酸而上肢可用：下一节换为肩部训练，降低工作量并取消练后有氧。" : riskAdjustment ? "最新记录使原定进度需要复核；这里仅比较未来可执行的调整，确认前当前计划保持不变。" : phase ? planningPhrase(phase.objective, locale) : "根据你确认的目标、时间和训练环境生成。"}</Text>
      <View style={styles.reportMetricGrid}>
        <ReportMetric value={`${report.trainingDays} 天`} label="每周训练" />
        <ReportMetric value={report.sessionDurationMinutes ? `${report.sessionDurationMinutes} 分` : "按日调整"} label="单次预算" />
        <ReportMetric value={report.phaseDuration} label="首个阶段" />
      </View>
    <View style={styles.reportConfidenceRow}><Text style={styles.reportConfidence}>起始置信度 {report.confidencePercent}%</Text><Text style={styles.reportConfidenceMeta}>· 记录越完整，后续计划越具体</Text></View>
    </View>

    {recoveryAdjustment ? <View style={styles.reportCalibration}>
      <Text style={styles.reportCalibrationTitle}>这次实际会怎么调整</Text>
      <Text style={styles.reportCalibrationCopy}>下一节改为 {recoverySession ? readablePlanSessionTitle(recoverySession.title) : "肩部训练"}；本次以 {recoveryFirstSet?.targetRirRange ? `RIR ${recoveryFirstSet.targetRirRange.min}–${recoveryFirstSet.targetRirRange.max}` : "更保守的余力"} 完成，组间休息 {recoveryFirstSet?.rest?.unit === "seconds" ? `${recoveryFirstSet.rest.value} 秒` : "按动作提示"}，不安排练后有氧。确认前，当前版本不变。</Text>
    </View> : null}

    <ReportSectionHeading index="01" title={recoveryAdjustment ? "调整后的训练安排" : "首周训练计划"} subtitle={report.weekRange ? `${report.weekRange} · ${report.totalWorkSets} 个力量训练工作组` : "当前周安排"} />
    <View style={styles.weekStrip}>{report.sessions.map((session) => <View key={session.id} style={[styles.weekStripDay, session.kind === "training" && styles.weekStripDayOn]}><Text style={[styles.weekStripLabel, session.kind === "training" && styles.weekStripLabelOn]}>{session.dayLabel.slice(1)}</Text><View style={[styles.weekStripDot, session.kind === "training" && styles.weekStripDotOn]} /><Text style={[styles.weekStripDate, session.kind === "training" && styles.weekStripDateOn]}>{Number(session.date.slice(-2))}</Text></View>)}</View>
    {trainingSessions.map((session, index) => <View key={session.id} style={styles.reportSessionCard}>
      <View style={styles.reportSessionTop}><View><Text style={styles.reportSessionDate}>{weekdayAndDate(session.scheduledFor)}</Text><Text style={styles.reportSessionTitle}>{readablePlanSessionTitle(session.title)}</Text></View><Text style={styles.reportSessionOrdinal}>{String(index + 1).padStart(2, "0")}</Text></View>
      <View style={styles.reportTaskList}>{session.tasks.map((task) => <View key={task.id} style={styles.reportTaskRow}><View style={styles.reportTaskBullet} /><Text numberOfLines={1} style={styles.reportTaskName}>{exerciseDisplayName(task.exerciseVariantId)}</Text><Text style={styles.reportTaskDose}>{planTaskDose(task)}</Text></View>)}</View>
      {session.aerobicBlock ? <View style={styles.reportAerobicBlock}><Text style={styles.reportAerobicTitle}>{session.aerobicBlock.placement === "after_strength" ? "力量完成后有氧" : "独立有氧"} · {session.aerobicBlock.minutes} 分钟</Text><Text style={styles.reportAerobicCopy}>RPE {session.aerobicBlock.targetRpe.min}–{session.aerobicBlock.targetRpe.max} · {session.aerobicBlock.talkTest} {session.aerobicBlock.fastedEligible ? "空腹仅可按偏好选择，不增加减脂承诺。" : "本计划不安排空腹有氧。"}</Text>{session.aerobicBlock.safetyNote ? <Text style={styles.reportAerobicGuard}>{session.aerobicBlock.safetyNote}</Text> : null}</View> : null}
      <Text style={styles.reportSessionFoot}>{session.estimatedDuration?.unit === "minutes" ? `预计 ${session.estimatedDuration.value} 分钟${session.durationBudget?.unit === "minutes" ? ` · 可用最多 ${session.durationBudget.value} 分钟` : ""}` : session.durationBudget?.unit === "minutes" ? `可用最多 ${session.durationBudget.value} 分钟` : "按完成质量调整时长"} · {session.kind === "cardio" ? "以能稳定完成的强度为准" : strengthBaselineNeedsSetContext ? "已读取力量参考；首场确认最近工作组的次数与余力" : "工作重量从可控热身逐步确认"}</Text>
    </View>)}
    <View style={styles.reportRuleCard}><Text style={styles.reportRuleEyebrow}>如何进阶</Text>{(proposal.trainingStrategy?.progression ?? []).map((rule) => <ReportBullet key={rule} text={planningPhrase(rule, locale)} />)}{(proposal.trainingStrategy?.recoveryRules ?? []).map((rule) => <ReportBullet key={rule} text={planningPhrase(rule, locale)} tone="guard" />)}</View>

    <ReportSectionHeading index="02" title="每日摄入计划" subtitle="先建立可执行基线，再用真实趋势校准" />
    <View style={styles.nutritionReportCard}>
      <View style={styles.nutritionReportMetrics}>
        <View style={styles.nutritionReportMetric}><Text style={styles.nutritionReportValue}>{energyRange ? `${Math.round(energyRange.min.value)}–${Math.round(energyRange.max.value)}` : "7 天基线"}</Text><Text style={styles.nutritionReportLabel}>{energyRange ? "kcal / 天" : "热量策略"}</Text></View>
        <View style={styles.nutritionReportDivider} />
        <View style={styles.nutritionReportMetric}><Text style={styles.nutritionReportValue}>{hasProteinTarget ? `${protein!.min}–${protein!.max} g` : "每餐有蛋白"}</Text><Text style={styles.nutritionReportLabel}>蛋白质</Text></View>
      </View>
      {!energyRange ? <View style={styles.reportCalibration}><Text style={styles.reportCalibrationTitle}>为什么没有硬填一个热量数字？</Text><Text style={styles.reportCalibrationCopy}>你还没有提供足够的维持热量输入。前 7 天按平常吃法完成至少 3 个完整日记录，系统再结合体重趋势给出可复核的范围。</Text></View> : <View style={styles.reportCalibration}><Text style={styles.reportCalibrationTitle}>这是起始估算，不是测得消耗</Text><Text style={styles.reportCalibrationCopy}>确认后，摄入 Tab 会把周均目标分配到训练日与休息日；已确认的额外运动只增加一笔最多 200 kcal 的保守补给。两周后再用饮食与同条件体重趋势校准。</Text></View>}
      {rollingEnergy?.status === "gentle_rebalance" ? <View style={styles.reportCalibration}><Text style={styles.reportCalibrationTitle}>{rebalanceIsEstimate ? "聚餐后的暂估回调 · 待你确认" : "已记录聚餐后的温和回调 · 待你确认"}</Text><Text style={styles.reportCalibrationCopy}>{rebalanceIsEstimate ? `你上报了“吃多/聚餐”但没有热量；Planner 按高于计划约 ${rebalanceRange?.min ?? 0}–${rebalanceRange?.max ?? 0} kcal 的保守范围暂估，补录热量后会自动改用真实差额。` : `最近量化记录相对计划多出约 ${rollingEnergy.unrecoveredSurplusKcal} kcal；已按这个差额计算后续活动量。`} 接下来 {rollingEnergy.horizonDays} 个可用时段，{rebalanceActivityText}，预计先分摊约 {rebalanceActionKcal} kcal；仍有约 {rebalanceRemainingKcal} kcal 留给后续趋势复核。只在恢复正常时执行，不以空腹、间歇或加练腿部来硬抵消。若选择保留原计划，不代表失败，但本周预计赤字会少约 {rollingEnergy.unrecoveredSurplusKcal} kcal、进度会相应放慢；保持下一餐正常、完成下一次训练，仍然比极端节食更能把计划拉回正轨。</Text></View> : null}
      <View style={styles.intakeSteps}>
        <IntakeStep index="1" title="每天分成 3–4 餐" detail={hasProteinTarget ? `把 ${protein!.min}–${protein!.max} g 蛋白质平均分配，优先来自正餐。` : "每餐安排一个明确蛋白质来源；补充体重后会换算为克数。"} />
        <IntakeStep index="2" title="训练前后安排主食" detail="把更容易消化的碳水放在训练前后；休息日不因一次漏练自动大幅减餐。" />
        <IntakeStep index="3" title="保留脂肪与蔬果底线" detail={`脂肪不低于总能量的 ${nutritionStrategy?.macronutrientTargets?.fatEnergyFloorPercent ?? 20}%，其余空间按饥饿、消化和训练表现调整。`} />
        <IntakeStep index="4" title="两周做第一次复核" detail={`在 ${nutritionStrategy?.reviewWindow?.endsAt ?? report.reviewAt} 前记录至少 3 次同条件体重，不用单日波动改方向。`} />
      </View>
    </View>

    <ReportSectionHeading index="03" title="为什么这样安排" subtitle="训练、营养与恢复使用同一组边界" />
    <View style={styles.strategyStack}>
      <StrategyReportCard mark="T" title="训练" copy={planningPhrase(proposal.trainingStrategy?.objective ?? "progress_with_recovery_budget", locale)} />
      <StrategyReportCard mark="N" title="营养" copy={planningPhrase(proposal.nutritionStrategy?.objective ?? "support_goal_while_observing_real_intake", locale)} />
      <StrategyReportCard mark="R" title="恢复" copy={planningPhrase(proposal.recoveryStrategy?.objective ?? "keep_daily_variation inside a safe next-session boundary", locale)} />
    </View>
    {proposal.explanation ? <View style={styles.reportEvidenceCard}>
      <Text style={styles.reportRuleEyebrow}>你的事实与决策逻辑</Text>
      {proposal.explanation.userEvidence.map((item) => <ReportBullet key={item} text={planningPhrase(item, locale)} />)}
      {proposal.explanation.ruleReason.map((item) => <ReportBullet key={item} text={planningPhrase(item, locale)} />)}
    </View> : null}

    <ReportSectionHeading index="04" title="三条推进路径" subtitle="日期是复核窗口，不是结果保证" />
    <View style={styles.forecastStack}>{(proposal.adaptiveForecasts ?? []).map((forecast) => <View key={forecast.scenario} style={[styles.forecastReportCard, forecast.scenario === "balanced" && styles.forecastReportCardRecommended]}>
      <View style={styles.forecastReportTop}><View><Text style={styles.forecastReportTitle}>{forecastName(forecast.scenario, locale)}</Text><Text style={styles.forecastReportEligibility}>{forecastEligibility(forecast.eligibility, locale)}</Text></View>{forecast.scenario === "balanced" ? <Text style={styles.forecastRecommended}>推荐</Text> : null}</View>
      <Text style={styles.forecastReportDate}>{shortDate(forecast.earliest)}—{shortDate(forecast.latest)}</Text>
      <Text style={styles.forecastReportMeta}>需要：{forecast.executionRequirements.map((value) => planningPhrase(value, locale)).join("；")}</Text>
      <Text style={styles.forecastReportMeta}>取舍：{forecast.tradeoffs.map((value) => planningPhrase(value, locale)).join("；")}</Text>
      <Text style={styles.forecastReportConfidence}>可信区间 {Math.round(forecast.confidence.min * 100)}–{Math.round(forecast.confidence.max * 100)}% · {shortDate(forecast.recalibrateAt)} 复核</Text>
    </View>)}</View>

    <ReportSectionHeading index="05" title="未知项与证据边界" subtitle="不知道的内容不会被模型猜测" />
    <View style={styles.reportUnknownCard}>
      {report.missingFacts.map((item) => <ReportBullet key={item} text={item} tone="unknown" />)}
      {proposal.explanation?.researchEvidence.map((citation) => <View key={citation.citationId} style={styles.reportCitation}><Text style={styles.reportCitationTitle}>本地知识版本 · {citation.citationId}</Text><Text style={styles.reportCitationCopy}>{citation.claim}。适用范围：{planningPhrase(citation.population, locale)}；局限：{citation.limitation}。</Text></View>)}
      <Text style={styles.reportBoundary}>这份报告由本地规则引擎从你确认的资料生成；LLM 负责解释和交互，不可自行改写训练计划或补造热量、重量与身体事实。</Text>
    </View>
    {error ? <Text style={styles.formError}>{error}</Text> : null}
    {preview.planningPreview?.status === "awaiting_confirmation" && onConfirm ? <Pressable accessibilityRole="button" accessibilityLabel={rollingEnergy?.status === "gentle_rebalance" ? "确认这次温和回调" : recoveryAdjustment ? "确认这次肩日调整" : riskAdjustment ? "确认这份后续调整" : "接受报告并创建第一周"} disabled={busy} onPress={onConfirm} style={[styles.reportConfirmButton, busy && styles.primaryButtonDisabled]}><Text style={styles.reportConfirmText}>{busy ? "正在创建第一周…" : rollingEnergy?.status === "gentle_rebalance" ? "确认这次温和回调" : recoveryAdjustment ? "确认这次肩日调整" : riskAdjustment ? "确认这份后续调整" : "接受报告并创建第一周"}</Text><Text style={styles.reportConfirmArrow}>→</Text></Pressable> : null}
    <Pressable accessibilityRole="button" accessibilityLabel="根据最新资料重新分析" disabled={busy} onPress={onRecompute} style={styles.reportSecondaryButton}><Text style={styles.reportSecondaryText}>资料有变化，重新分析</Text></Pressable>
    {preview.planningPreview?.status === "awaiting_confirmation" && onReject ? <Pressable accessibilityRole="button" accessibilityLabel="暂不启用计划" disabled={busy} onPress={onReject} style={styles.previewRejectButton}><Text style={styles.previewRejectText}>暂不启用这份计划</Text></Pressable> : null}
  </ScrollView>;
}

function OnboardingSectionHeading({ step, label, hint }: { step: string; label: string; hint: string }) {
  return <View style={styles.quickChoiceHeading}><Text style={styles.quickChoiceStep}>{step}</Text><View style={styles.quickChoiceHeadingBody}><Text style={styles.quickChoiceTitle}>{label}</Text><Text style={styles.quickChoiceHint}>{hint}</Text></View></View>;
}

function QuickChoice<T extends string>({ step, label, hint, options, selected, onSelect }: { step: string; label: string; hint: string; options: readonly { id: T; label: string }[]; selected: T; onSelect: (id: T) => void }) {
  return <View style={styles.quickChoiceCard}><OnboardingSectionHeading step={step} label={label} hint={hint} /><View style={styles.optionList}>{options.map((option) => <Pressable key={option.id} accessibilityRole="radio" accessibilityState={{ checked: selected === option.id }} aria-checked={selected === option.id} accessibilityLabel={option.label} onPress={() => onSelect(option.id)} style={[styles.option, styles.quickChoiceOption, selected === option.id && styles.optionSelected]}><Text style={[styles.optionText, selected === option.id && styles.optionTextSelected]}>{option.label}</Text></Pressable>)}</View></View>;
}

function ReportSectionHeading({ index, title, subtitle }: { index: string; title: string; subtitle: string }) {
  return <View style={styles.reportSectionHeading}><Text style={styles.reportSectionIndex}>{index}</Text><View style={styles.reportSectionHeadingBody}><Text style={styles.reportSectionTitle}>{title}</Text><Text style={styles.reportSectionSubtitle}>{subtitle}</Text></View></View>;
}

function ReportMetric({ value, label }: { value: string; label: string }) {
  return <View style={styles.reportMetric}><Text style={styles.reportMetricValue}>{value}</Text><Text style={styles.reportMetricLabel}>{label}</Text></View>;
}

function ReportBullet({ text, tone = "default" }: { text: string; tone?: "default" | "guard" | "unknown" }) {
  return <View style={styles.reportBulletRow}><View style={[styles.reportBullet, tone === "guard" && styles.reportBulletGuard, tone === "unknown" && styles.reportBulletUnknown]} /><Text style={styles.reportBulletText}>{text}</Text></View>;
}

function IntakeStep({ index, title, detail }: { index: string; title: string; detail: string }) {
  return <View style={styles.intakeStep}><Text style={styles.intakeStepIndex}>{index}</Text><View style={styles.intakeStepBody}><Text style={styles.intakeStepTitle}>{title}</Text><Text style={styles.intakeStepDetail}>{detail}</Text></View></View>;
}

function StrategyReportCard({ mark, title, copy }: { mark: string; title: string; copy: string }) {
  return <View style={styles.strategyReportCard}><View style={styles.strategyReportMark}><Text style={styles.strategyReportMarkText}>{mark}</Text></View><View style={styles.strategyReportBody}><Text style={styles.strategyReportTitle}>{title}</Text><Text style={styles.strategyReportCopy}>{copy}</Text></View></View>;
}

function Question<T extends string>({ label, options, selected, onSelect }: { label: string; options: readonly { id: T; label: string }[]; selected: T; onSelect: (id: T) => void }) {
  return <View style={styles.question}><Text style={styles.questionLabel}>{label}</Text><View style={styles.optionList}>{options.map((option) => <Pressable key={option.id} accessibilityRole="radio" accessibilityState={{ checked: selected === option.id }} aria-checked={selected === option.id} onPress={() => onSelect(option.id)} style={[styles.option, selected === option.id && styles.optionSelected]}><Text style={[styles.optionText, selected === option.id && styles.optionTextSelected]}>{option.label}</Text></Pressable>)}</View></View>;
}

function WorkoutScreen({ application, cloudConfirmed, userId, workoutId, coachStream, onSendToCoach, onCoachCardAction, onCoachHumanAction, onOpenCoach, onFinished, onUnavailable, onOpenSavedVideo, locale }: {
  application: CoachApplication;
  cloudConfirmed: ConfirmedProductBridge;
  userId: string;
  workoutId: string;
  coachStream: CoachStreamSnapshot;
  onSendToCoach: (text: string) => Promise<void> | void;
  onCoachCardAction: (actionId: string, artifactId: string) => Promise<void> | void;
  onCoachHumanAction: (pendingActionId: string, optionId: string) => Promise<void> | void;
  onOpenCoach: () => void;
  onFinished: () => void;
  onUnavailable: () => void;
  onOpenSavedVideo: (selection: ReplaySelection) => void;
  /** From profile.locale; falls back to English when unknown. */
  locale?: string;
}) {
  const [workout, setWorkout] = useState<Awaited<ReturnType<CoachApplication["readWorkoutSession"]>>>();
  const [error, setError] = useState<string>();
  const [restRemaining, setRestRemaining] = useState<number | null>(null);
  const [editingActual, setEditingActual] = useState(false);
  const [editingTarget, setEditingTarget] = useState(false);
  const [actualReps, setActualReps] = useState("");
  const [actualLoad, setActualLoad] = useState("");
  const [actualRir, setActualRir] = useState("");
  const [targetReps, setTargetReps] = useState("");
  const [targetLoad, setTargetLoad] = useState("");
  const [targetRir, setTargetRir] = useState("");
  const [managingUpcomingTasks, setManagingUpcomingTasks] = useState(false);
  const [showSafetyPauseChoices, setShowSafetyPauseChoices] = useState(false);
  const [showSkipSet, setShowSkipSet] = useState(false);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [finishReviewOpen, setFinishReviewOpen] = useState(false);
  const [finishSaveState, setFinishSaveState] = useState<"idle" | "saving" | "failed" | "conflict">("idle");
  const [nextSetRecommendation, setNextSetRecommendation] = useState<Awaited<ReturnType<CoachApplication["recommendNextWorkoutSet"]>>>();
  const load = useCallback(async () => {
    try {
      setWorkout(await application.readWorkoutSession({ userId, workoutId }));
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法读取训练");
    }
  }, [application, userId, workoutId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!workout?.state.restTimer) {
      setRestRemaining(null);
      return;
    }
    let active = true;
    const refreshRest = async () => {
      try {
        const remaining = await application.remainingWorkoutRest({ userId, workoutId });
        if (active) setRestRemaining(remaining);
      } catch {
        if (active) setRestRemaining(null);
      }
    };
    void refreshRest();
    const interval = setInterval(() => { void refreshRest(); }, 1_000);
    return () => { active = false; clearInterval(interval); };
  }, [application, userId, workoutId, workout?.state.restTimer?.id, workout?.state.restTimer?.deadlineWallClockAt]);
  if (!workout) return error
    ? <ErrorState title="未找到这次训练" message={error} onRetry={onUnavailable} retryLabel="返回今天" />
    : <LoadingState />;
  if (workout.status === "paused") {
    return <PausedWorkoutScreen application={application} cloudConfirmed={cloudConfirmed} userId={userId} workoutId={workoutId} reason={workout.state.pauseReason} onFinished={onFinished} onResumed={() => void load()} />;
  }
  const completed = new Set(workout.setOutcomes.map((outcome) => outcome.prescriptionSetId));
  const skipped = new Set((workout.skippedSets ?? []).map((set) => set.prescriptionSetId));
  const resolved = new Set([...completed, ...skipped]);
  const pending = workout.state.currentSetId
    ? workout.frozenPrescription.tasks.flatMap((task) => task.sets.map((set) => ({ task, set }))).find(({ set }) => set.id === workout.state.currentSetId && !resolved.has(set.id))
    : workout.frozenPrescription.tasks.flatMap((task) => task.sets.map((set) => ({ task, set }))).find(({ set }) => !resolved.has(set.id));
  const pendingDraft = pending ? workout.drafts.find((draft) => draft.prescriptionSetId === pending.set.id) : undefined;
  const persistedObservation = pending
    ? [...(workout.setObservations ?? [])].reverse().find((item) => item.prescriptionSetId === pending.set.id)
    : undefined;
  const pendingSetIndex = pending ? pending.task.sets.findIndex((set) => set.id === pending.set.id) + 1 : 0;
  const runtimePlatform = Platform.OS === "android" || Platform.OS === "ios" ? Platform.OS : "web";
  const realtimeCapability = pending ? resolveWorkoutSetRealtimeCapability({
    exerciseVariantId: pending.task.exerciseVariantId,
    platform: runtimePlatform,
    nativeRuntimeAvailable: runtimePlatform !== "web",
  }) : undefined;
  const realtimeAvailable = realtimeCapability?.available === true;
  const executionLoad = pendingDraft?.actualLoad ?? pending?.set.targetLoad;
  const realtimeContext: WorkoutSetRealtimeContext | undefined = pending ? {
    workoutId,
    setId: pending.set.id,
    exerciseVariantId: pending.task.exerciseVariantId,
    setIndex: pendingSetIndex,
    ...(pending.set.targetReps ? { targetReps: pending.set.targetReps.max } : {}),
    ...(executionLoad ? { executionLoad } : {}),
    ...(realtimeCapability?.profileIdentity ? { capabilityIdentity: realtimeCapability.profileIdentity } : {}),
  } : undefined;
  if (workout.state.mode === "coach_monitor" && pending && realtimeContext) {
    return (
      <WorkoutMonitorWorkspace
        application={application}
        userId={userId}
        workoutId={workoutId}
        exerciseVariantId={pending.task.exerciseVariantId}
        setContext={realtimeContext}
        coachStream={coachStream}
        onSendToCoach={onSendToCoach}
        onCoachCardAction={onCoachCardAction}
        onCoachHumanAction={onCoachHumanAction}
        onExit={() => void load()}
        onObservationReady={(observation) => {
          setActualReps(String(observation.report.confirmedCount));
          setActualLoad(pendingDraft?.actualLoad ? String(pendingDraft.actualLoad.value) : pending.set.targetLoad ? String(pending.set.targetLoad.value) : "");
          setActualRir(pendingDraft?.actualRir === undefined ? "" : String(pendingDraft.actualRir));
          setEditingActual(true);
          void load();
        }}
        onOpenSavedVideo={onOpenSavedVideo}
        locale={locale}
      />
    );
  }
  const startRest = async (setId: string, duration: { value: number; unit: "seconds" | "minutes" | "hours" }) => {
    await application.startRestTimer({
      userId,
      workoutId,
      setId,
      duration,
      idempotencyKey: `mobile-workout:${workoutId}:rest:${setId}`,
    });
  };
  const refreshNextSetRecommendation = async (sourceOutcomeId: string) => {
    try {
      const recommendation = await application.recommendNextWorkoutSet({ userId, workoutId, sourceOutcomeId });
      setNextSetRecommendation(recommendation.status === "proposal" ? recommendation : undefined);
    } catch {
      // A missing RulePack, equipment profile, or RIR is intentionally quiet:
      // the just-recorded set remains valid and the next set stays unchanged.
      setNextSetRecommendation(undefined);
    }
  };
  const skipCurrentSet = async (reason: string) => {
    if (!pending) return;
    try {
      await cloudConfirmed.confirmResultThen({
        localWorkoutId: workoutId,
        localResultId: pending.set.id,
        kind: "workout_set_skipped",
        payload: { prescriptionSetId: pending.set.id, reason },
        provenance: { source: "confirmed_user_input" },
        occurredAt: new Date().toISOString(),
        idempotencyKey: `mobile-workout:${workoutId}:skip:${pending.set.id}`,
        commitLocal: () => application.skipCurrentSet({
          userId,
          workoutId,
          reason,
          idempotencyKey: `mobile-workout:${workoutId}:skip:${pending.set.id}`,
        }),
      });
      setShowSkipSet(false);
      setNextSetRecommendation(undefined);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "本组未能跳过");
    }
  };
  const openActual = () => {
    if (!pending) return;
    setActualReps(pendingDraft?.actualReps !== undefined
      ? String(pendingDraft.actualReps)
      : persistedObservation?.judgement === "observed"
        ? String(persistedObservation.counts.confirmed)
        : pending.set.targetReps ? String(pending.set.targetReps.max) : "");
    setActualLoad(pendingDraft?.actualLoad ? String(pendingDraft.actualLoad.value) : pending.set.targetLoad ? String(pending.set.targetLoad.value) : "");
    setActualRir(pendingDraft?.actualRir !== undefined ? String(pendingDraft.actualRir) : pending.set.targetRir === undefined ? "" : String(pending.set.targetRir));
    setEditingActual(true);
  };
  const openTarget = () => {
    if (!pending) return;
    setTargetReps(pending.set.targetReps ? String(pending.set.targetReps.max) : "");
    setTargetLoad(pending.set.targetLoad ? String(pending.set.targetLoad.value) : "");
    setTargetRir(pending.set.targetRir === undefined ? "" : String(pending.set.targetRir));
    setEditingTarget(true);
  };
  const persistActualDraft = async () => {
    if (!pending) return;
    const reps = optionalFiniteNumber(actualReps);
    const actualLoadValue = optionalFiniteNumber(actualLoad);
    const rir = optionalFiniteNumber(actualRir);
    if (pending.set.targetReps && (reps === undefined || !Number.isInteger(reps) || reps < 0)) {
      setError("请填写实际次数。");
      return;
    }
    if (actualLoadValue !== undefined && actualLoadValue < 0) { setError("重量不能小于 0。"); return; }
    if (rir !== undefined && (rir < 0 || rir > 10)) { setError("RIR 需要在 0 到 10 之间。"); return; }
    const draft = await application.saveCurrentSetDraft({
        userId,
        workoutId,
        idempotencyKey: `mobile-workout:${workoutId}:draft:${pending.set.id}`,
        draft: {
          ...(reps !== undefined ? { actualReps: reps } : {}),
          ...(actualLoadValue !== undefined ? { actualLoad: { value: actualLoadValue, unit: pendingDraft?.actualLoad?.unit ?? pending.set.targetLoad?.unit ?? "kg" } } : {}),
          ...(rir !== undefined ? { actualRir: rir } : {}),
        },
      });
    return { draft, reps, actualLoadValue, rir };
  };
  const saveActualDraft = async () => {
    try {
      await persistActualDraft();
      setEditingActual(false);
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "本组草稿未能保存"); }
  };
  const confirmActual = async () => {
    if (!pending) return;
    try {
      const saved = await persistActualDraft();
      if (!saved) return;
      const { draft, reps, actualLoadValue, rir } = saved;
      const outcome = await cloudConfirmed.confirmResultThen({
        localWorkoutId: workoutId,
        localResultId: pending.set.id,
        kind: "workout_set",
        payload: {
          prescriptionSetId: pending.set.id,
          ...(reps !== undefined ? { actualReps: reps } : {}),
          ...(actualLoadValue !== undefined ? { actualLoad: actualLoadValue } : {}),
          ...(rir !== undefined ? { actualRir: rir } : {}),
        },
        provenance: { source: "confirmed_user_input" },
        occurredAt: new Date().toISOString(),
        idempotencyKey: `mobile-workout:${workoutId}:confirm:${pending.set.id}`,
        commitLocal: () => application.confirmCurrentSet({
          userId,
          workoutId,
          draftId: draft.id,
          ...(persistedObservation ? { observationId: persistedObservation.id } : {}),
          idempotencyKey: `mobile-workout:${workoutId}:confirm:${pending.set.id}`,
        }),
      });
      const rest = pending.set.rest ?? workout.state.policy.defaultRest;
      if (rest) await startRest(pending.set.id, rest);
      await refreshNextSetRecommendation(outcome.id);
      setEditingActual(false);
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "本组未能保存"); }
  };
  const saveTarget = async () => {
    if (!pending) return;
    const reps = optionalFiniteNumber(targetReps);
    const targetLoadValue = optionalFiniteNumber(targetLoad);
    const rir = optionalFiniteNumber(targetRir);
    if (pending.set.targetReps && (reps === undefined || !Number.isInteger(reps) || reps < 0)) {
      setError("目标次数需要是非负整数。");
      return;
    }
    if (targetLoadValue !== undefined && targetLoadValue < 0) { setError("目标重量不能小于 0。"); return; }
    if (rir !== undefined && (rir < 0 || rir > 10)) { setError("目标 RIR 需要在 0 到 10 之间。"); return; }
    try {
      const cloudPatch = {
        prescriptionSetId: pending.set.id,
        ...(reps !== undefined ? { targetReps: reps } : {}),
        ...(targetLoadValue !== undefined ? { targetLoad: targetLoadValue } : {}),
        ...(rir !== undefined ? { targetRir: rir } : {}),
      };
      await cloudConfirmed.updateWorkoutThen({
        localWorkoutId: workoutId,
        patch: { data: { latestPrescriptionChange: cloudPatch } },
        idempotencyKey: `mobile-workout:${workoutId}:revise:${pending.set.id}:cloud`,
        commitLocal: () => application.editUpcomingWorkoutPlan({
          userId,
          workoutId,
          change: {
            kind: "adjust_set",
            taskId: pending.task.id,
            setId: pending.set.id,
            patch: {
              ...(pending.set.targetReps && reps !== undefined ? { targetReps: { min: reps, max: reps } } : {}),
              ...(pending.set.targetLoad && targetLoadValue !== undefined ? { targetLoad: { value: targetLoadValue, unit: pending.set.targetLoad.unit } } : {}),
              ...(rir !== undefined ? { targetRir: rir } : {}),
            },
          },
          reason: "user_adjusted_unstarted_set",
          idempotencyKey: `mobile-workout:${workoutId}:revise:${pending.set.id}`,
        }),
      });
      setEditingTarget(false);
      setNextSetRecommendation(undefined);
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "本组开始后不能再修改目标"); }
  };
  const finish = async () => {
    try {
      setFinishSaveState("saving");
      const completedAt = new Date().toISOString();
      await cloudConfirmed.completeWorkoutThen({
        localWorkoutId: workoutId,
        summary: { status: pending ? "partial" : "completed" },
        completedAt,
        idempotencyKey: `mobile-workout:${workoutId}:finish:cloud`,
        commitLocal: () => application.completeWorkoutSession({
          userId,
          workoutId,
          status: pending ? "partial" : "completed",
          idempotencyKey: `mobile-workout:${workoutId}:finish`,
        }),
      });
      setFinishSaveState("idle");
      onFinished();
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : "训练未能结束";
      const conflict = /conflict|revision/i.test(detail);
      setFinishSaveState(conflict ? "conflict" : "failed");
      setError(conflict ? "训练总结存在云端版本冲突，本地训练尚未结束。" : "训练总结尚未获云端确认，本地训练尚未结束；可以重试。");
    }
  };
  const cancelRest = async () => {
    try {
      await application.cancelWorkoutRest({
        userId,
        workoutId,
        idempotencyKey: `mobile-workout:${workoutId}:rest:cancel:${workout.state.restTimer?.id ?? "none"}`,
      });
      setRestRemaining(null);
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "休息计时未能结束"); }
  };
  const adjustRest = async (deltaSeconds: number) => {
    try {
      await application.adjustWorkoutRest({
        userId,
        workoutId,
        deltaSeconds,
        idempotencyKey: `mobile-workout:${workoutId}:rest:${workout.state.restTimer?.id ?? "none"}:${deltaSeconds}`,
      });
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法调整休息时间"); }
  };
  const enableMonitor = async () => {
    if (!realtimeAvailable) return;
    try {
      await application.setWorkoutMonitoringMode({
        userId,
        workoutId,
        enabled: true,
        idempotencyKey: `mobile-workout:${workoutId}:monitor:on`,
      });
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "当前组进行中，请先完成或撤回本组记录。"); }
  };
  const pause = async () => {
    try {
      await application.pauseWorkoutSession({
        userId,
        workoutId,
        idempotencyKey: `mobile-workout:${workoutId}:pause`,
      });
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "暂时无法暂停训练"); }
  };
  const pauseForSafety = async (signal: "new_sharp_pain" | "chest_discomfort" | "dizziness_or_fainting" | "unusual_breathing_difficulty" | "known_constraint") => {
    try {
      await application.pauseWorkoutForSafety({
        userId,
        workoutId,
        signal,
        idempotencyKey: `mobile-workout:${workoutId}:safety:${signal}:${Date.now().toString(36)}`,
      });
      setShowSafetyPauseChoices(false);
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "暂时无法暂停训练"); }
  };
  const applyNextSetRecommendation = async () => {
    if (!nextSetRecommendation) return;
    try {
      await application.applyNextWorkoutSetRecommendation({
        recommendation: nextSetRecommendation,
        idempotencyKey: `mobile-workout:${workoutId}:apply-next-set:${nextSetRecommendation.sourceOutcomeId}`,
      });
      setNextSetRecommendation(undefined);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "下一组建议已过期，请重新查看当前记录。");
      setNextSetRecommendation(undefined);
    }
  };
  const focusTask = async (taskId: string) => {
    try {
      await application.focusWorkoutTask({
        userId,
        workoutId,
        taskId,
        idempotencyKey: `mobile-workout:${workoutId}:focus-task:${taskId}:${workout.revision}`,
      });
      setEditingActual(false);
      setEditingTarget(false);
      setHistoryExpanded(false);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "暂时无法切换动作");
    }
  };
  const currentExerciseOutcomes = pending
    ? workout.setOutcomes.filter((outcome) => outcome.exerciseVariantId === pending.task.exerciseVariantId)
    : [];
  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.workoutTop}><View><Text style={styles.screenTitle}>{readablePlanSessionTitle(workout.frozenPrescription.title)}</Text><Text style={styles.screenSub}>统一训练执行</Text></View><View style={styles.workoutTopActions}>{skipped.size ? <Text style={{ color: colors.terra, fontSize: 11, fontWeight: "800" }}>已跳过 {skipped.size} 组</Text> : null}<Pressable accessibilityRole="button" accessibilityLabel="打开训练中的 Coach" onPress={onOpenCoach} style={styles.workoutCoachButton}><Text style={styles.workoutCoachButtonText}>Coach</Text></Pressable></View></View>
      {restRemaining !== null ? <View style={styles.restCard}><View><Text style={styles.cardEyebrow}>组间休息</Text><Text style={styles.restTime}>{formatRestSeconds(restRemaining)}</Text>{pending ? <Text style={styles.workoutTaskBoundary}>下一组：{exerciseDisplayName(pending.task.exerciseVariantId)} · {setDose(pending.set)}</Text> : <Text style={styles.workoutTaskBoundary}>已没有待完成组</Text>}</View><View style={styles.restActions}><Pressable accessibilityRole="button" accessibilityLabel="减少三十秒休息" onPress={() => void adjustRest(-30)} style={styles.restAdd}><Text style={styles.restAddText}>−30 秒</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel="增加三十秒休息" onPress={() => void adjustRest(30)} style={styles.restAdd}><Text style={styles.restAddText}>+30 秒</Text></Pressable><Pressable accessibilityRole="button" onPress={() => void cancelRest()} style={styles.restCancel}><Text style={styles.restCancelText}>结束</Text></Pressable></View></View> : null}
      {nextSetRecommendation?.status === "proposal" ? <View style={styles.nextSetRecommendation}><View style={styles.nextSetRecommendationBody}><Text style={styles.cardEyebrow}>下一组建议 · {nextSetRecommendation.decision.decision.scope === "next_unstarted_set" ? "只影响下一未开始组" : nextSetRecommendation.decision.decision.scope}</Text><Text style={styles.nextSetRecommendationTitle}>调整前：{JSON.stringify(nextSetRecommendation.decision.decision.before)}</Text><Text style={styles.nextSetRecommendationTitle}>调整后：{JSON.stringify(nextSetRecommendation.decision.decision.after)}</Text><Text style={styles.nextSetRecommendationDetail}>{nextSetRecommendation.decision.explanation}</Text></View><View style={styles.workoutTaskButtons}><Pressable accessibilityRole="button" onPress={() => setNextSetRecommendation(undefined)} style={styles.workoutTaskSecondary}><Text style={styles.workoutTaskSecondaryText}>拒绝，保持原计划</Text></Pressable><Pressable accessibilityRole="button" onPress={() => setNextSetRecommendation(undefined)} style={styles.workoutTaskSecondary}><Text style={styles.workoutTaskSecondaryText}>暂时忽略</Text></Pressable><Pressable accessibilityRole="button" onPress={() => void applyNextSetRecommendation()} style={styles.nextSetRecommendationButton}><Text style={styles.nextSetRecommendationButtonText}>应用</Text></Pressable></View></View> : null}
      {pending ? (
        <View style={styles.currentSetCard}>
          <View style={styles.currentSetHeader}><Text style={styles.cardEyebrow}>当前组 · 第 {pendingSetIndex} 组</Text>{currentExerciseOutcomes.length ? <Pressable accessibilityRole="button" accessibilityLabel={`${historyExpanded ? "收起" : "查看"}${currentExerciseOutcomes.length}组完成历史`} accessibilityState={{ expanded: historyExpanded }} onPress={() => setHistoryExpanded((value) => !value)} style={styles.completedHistoryButton}><Text style={styles.completedHistoryButtonText}>已完成 {currentExerciseOutcomes.length} 组 ↻</Text></Pressable> : <Text style={styles.notRecordedText}>尚未记录</Text>}</View>
          <Text style={styles.currentSetTitle}>{exerciseDisplayName(pending.task.exerciseVariantId)}</Text>
          <Text style={styles.currentSetDose}>{setDose(pending.set)}</Text>
          <Text style={styles.currentSetBoundary}>重量、RIR 与疼痛只来自你的确认；相机不会替你推断。</Text>
          {historyExpanded ? <View accessibilityLabel="已确认组历史" style={styles.completedHistory}>{currentExerciseOutcomes.map((outcome, index) => {
            const previous = currentExerciseOutcomes[index - 1];
            const loadChange = outcome.actualLoad && previous?.actualLoad && outcome.actualLoad.unit === previous.actualLoad.unit ? outcome.actualLoad.value - previous.actualLoad.value : undefined;
            const repsChange = outcome.actualReps !== undefined && previous?.actualReps !== undefined ? outcome.actualReps - previous.actualReps : undefined;
            return <View key={outcome.id} style={styles.completedHistoryRow}><Text style={styles.completedHistoryIndex}>{index + 1}</Text><Text style={styles.completedHistoryDose}>{outcome.actualLoad ? `${outcome.actualLoad.value}${outcome.actualLoad.unit} × ` : ""}{outcome.actualReps ?? "—"}</Text><Text style={styles.completedHistoryDelta}>{index === 0 ? "首组" : `${loadChange === undefined ? "负荷未知" : loadChange > 0 ? `加重 ${loadChange}` : loadChange < 0 ? `减重 ${Math.abs(loadChange)}` : "负荷持平"}${repsChange === undefined || repsChange === 0 ? "" : repsChange > 0 ? ` · +${repsChange} 次` : ` · ${repsChange} 次`}`}</Text></View>;
          })}</View> : null}
          {editingActual ? (
            <View style={styles.actualForm}>
              <Text style={styles.setReviewTitle}>Set Review</Text>
              <Text style={styles.setReviewSnapshot}>计划快照：{setDose(pending.set)}</Text>
              {persistedObservation ? <View style={styles.observationSummary}><Text style={styles.observationSummaryTitle}>Canonical observation · 本机留存</Text><Text style={styles.observationSummaryText}>已确认 {persistedObservation.counts.confirmed} · 待复核 {persistedObservation.counts.needsReview} · 已拒绝 {persistedObservation.counts.rejected}</Text><Text style={styles.observationSummaryBoundary}>{persistedObservation.judgement === "cannot_judge" ? "当前相机证据无法判断；请手动确认。" : "只有已确认次数用于预填；原观察不会被你的修正覆盖。"} 此观察尚不是云端 confirmed Result。</Text></View> : <Text style={styles.setReviewSnapshot}>观察：手动记录（无相机证据）</Text>}
              <ActualInput label="次数" value={actualReps} onChange={setActualReps} />
              <ActualInput label="重量" value={actualLoad} onChange={setActualLoad} />
              <ActualInput label="RIR" value={actualRir} onChange={setActualRir} />
              <Pressable accessibilityRole="button" onPress={() => void confirmActual()} style={styles.primaryButton}><Text style={styles.primaryButtonText}>确认实际完成</Text></Pressable>
              <Pressable accessibilityRole="button" onPress={() => void saveActualDraft()} style={styles.actualButton}><Text style={styles.actualButtonText}>保存本组输入，稍后完成</Text></Pressable>
            </View>
          ) : editingTarget ? (
            <View style={styles.actualForm}>
              <ActualInput label="目标次数" value={targetReps} onChange={setTargetReps} />
              {pending.set.targetLoad ? <ActualInput label="目标重量" value={targetLoad} onChange={setTargetLoad} /> : null}
              <ActualInput label="目标 RIR" value={targetRir} onChange={setTargetRir} />
              <Text style={styles.currentSetBoundary}>保存后只影响尚未开始的这一组。</Text>
              <Pressable accessibilityRole="button" onPress={() => void saveTarget()} style={styles.primaryButton}><Text style={styles.primaryButtonText}>保存目标</Text></Pressable>
            </View>
          ) : (
            <>
              <Pressable accessibilityRole="button" onPress={openActual} style={styles.primaryButton}><Text style={styles.primaryButtonText}>完成本组并检查</Text></Pressable>
              {realtimeAvailable ? <View style={styles.monitorEntry}><View><Text style={styles.monitorEntryTitle}>Realtime 自动计次</Text><Text style={styles.monitorEntrySub}>当前动作与机位具备 exact capability；相机不会确认重量或 RIR</Text></View><Pressable accessibilityRole="button" accessibilityLabel="为当前组开启 Realtime 自动计次" onPress={() => void enableMonitor()} style={styles.monitorEntryButton}><Text style={styles.monitorEntryButtonText}>开启</Text></Pressable></View> : null}
              <View style={styles.setActions}>
                <Pressable accessibilityRole="button" onPress={openTarget} style={styles.actualButton}><Text style={styles.actualButtonText}>调整本组目标</Text></Pressable>
                <Pressable accessibilityRole="button" onPress={() => setShowSkipSet(true)} style={styles.actualButton}><Text style={styles.skipSetText}>跳过本组</Text></Pressable>
              </View>
            </>
          )}
          {!editingActual && !editingTarget ? <Pressable accessibilityRole="button" onPress={() => setManagingUpcomingTasks(true)} style={styles.manageWorkoutTasksButton}><Text style={styles.manageWorkoutTasksText}>管理后续动作</Text></Pressable> : null}
        </View>
      ) : <Empty label="本次计划中的组已处理。" />}
      <Text style={styles.sectionTitle}>今日动作路线</Text>
      {workout.frozenPrescription.tasks.map((task) => {
        const taskCompleted = workout.setOutcomes.filter((outcome) => outcome.exerciseVariantId === task.exerciseVariantId).length;
        const hasPending = task.sets.some((set) => !resolved.has(set.id));
        return <Pressable key={task.id} accessibilityRole="button" accessibilityLabel={`切换到${exerciseDisplayName(task.exerciseVariantId)}`} accessibilityState={{ selected: pending?.task.id === task.id, disabled: !hasPending }} disabled={!hasPending} onPress={() => void focusTask(task.id)} style={[styles.workoutTask, pending?.task.id === task.id && styles.workoutTaskSelected]}><View style={styles.workoutRouteRow}><View style={{ flex: 1 }}><Text style={styles.workoutTaskTitle}>{exerciseDisplayName(task.exerciseVariantId)}</Text><Text style={styles.workoutRouteMeta}>{taskCompleted ? `已完成 ${taskCompleted} 组` : "尚未记录"}</Text></View><Text style={styles.chevron}>›</Text></View></Pressable>;
      })}
      {error ? <Text style={styles.formError}>{error}</Text> : null}
      <Pressable accessibilityRole="button" onPress={() => void pause()} style={styles.pauseButton}><Text style={styles.pauseButtonText}>暂停训练</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={() => setShowSafetyPauseChoices(true)} style={styles.safetyPauseButton}><Text style={styles.safetyPauseButtonText}>安全暂停</Text></Pressable>
      {finishReviewOpen ? <View style={styles.workoutTaskPicker}><Text style={styles.logTitle}>训练实际总结</Text><Text style={styles.workoutTaskBoundary}>已确认 {workout.setOutcomes.length} 组 · 已跳过 {skipped.size} 组 · canonical observation 覆盖 {(workout.setObservations ?? []).length} 组 · 用户修正 {workout.setOutcomes.filter((item) => item.performedRepsProvenance?.userAdjusted).length} 组</Text><Text style={styles.workoutTaskBoundary}>保存状态：{finishSaveState === "saving" ? "等待云端确认" : finishSaveState === "conflict" ? "云端冲突，未保存" : finishSaveState === "failed" ? "未获云端确认，可重试" : "尚未提交"}</Text><View style={styles.workoutTaskButtons}><Pressable accessibilityRole="button" disabled={finishSaveState === "saving"} onPress={() => setFinishReviewOpen(false)} style={styles.workoutTaskSecondary}><Text style={styles.workoutTaskSecondaryText}>返回训练</Text></Pressable><Pressable accessibilityRole="button" disabled={finishSaveState === "saving"} onPress={() => void finish()} style={styles.nextSetRecommendationButton}><Text style={styles.nextSetRecommendationButtonText}>{finishSaveState === "failed" || finishSaveState === "conflict" ? "重试确认" : pending ? "确认部分完成" : "确认完成"}</Text></Pressable></View></View> : <Pressable accessibilityRole="button" onPress={() => setFinishReviewOpen(true)} style={styles.finishButton}><Text style={styles.finishButtonText}>{pending ? "查看部分完成总结" : "查看训练总结"}</Text></Pressable>}
      {managingUpcomingTasks ? <WorkoutTaskEditor application={application} cloudConfirmed={cloudConfirmed} userId={userId} workout={workout} onDismiss={() => setManagingUpcomingTasks(false)} onChanged={() => { setNextSetRecommendation(undefined); void load(); }} /> : null}
      {showSafetyPauseChoices ? <SafetyPauseChoices onDismiss={() => setShowSafetyPauseChoices(false)} onSelect={(signal) => void pauseForSafety(signal)} /> : null}
      {showSkipSet && pending ? <SkipCurrentSetSheet exerciseVariantId={pending.task.exerciseVariantId} onDismiss={() => setShowSkipSet(false)} onConfirm={(reason) => void skipCurrentSet(reason)} /> : null}
    </ScrollView>
  );
}

function SkipCurrentSetSheet({
  exerciseVariantId,
  onDismiss,
  onConfirm,
}: {
  exerciseVariantId: string;
  onDismiss: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string>();
  const submit = () => {
    const value = reason.trim();
    if (!value) {
      setError("请说明跳过原因，方便后续安排理解这次记录。");
      return;
    }
    onConfirm(value);
  };
  return <View accessibilityViewIsModal style={styles.safetyPauseScrim}>
    <Pressable accessibilityRole="button" accessibilityLabel="关闭跳过本组" onPress={onDismiss} style={StyleSheet.absoluteFill} />
    <View style={styles.skipSetSheet}>
      <View style={styles.sheetHandle} />
      <Text style={styles.cardEyebrow}>训练记录</Text>
      <Text style={styles.skipSetTitle}>跳过这一组？</Text>
      <Text style={styles.skipSetDetail}>{exerciseDisplayName(exerciseVariantId)} 会保留在今天的训练记录中，但不会算作已完成训练量。</Text>
      <TextInput
        accessibilityLabel="跳过原因"
        value={reason}
        onChangeText={(value) => { setReason(value); setError(undefined); }}
        placeholder="例如：器械被占用、时间不足、状态不适合"
        placeholderTextColor={colors.ink3}
        style={styles.skipSetInput}
        multiline
        maxLength={240}
      />
      {error ? <Text style={styles.formError}>{error}</Text> : null}
      <Pressable accessibilityRole="button" onPress={submit} style={styles.skipSetConfirm}><Text style={styles.skipSetConfirmText}>确认跳过</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={onDismiss} style={styles.safetyPauseCancel}><Text style={styles.safetyPauseCancelText}>继续这一组</Text></Pressable>
    </View>
  </View>;
}

function SafetyPauseChoices({ onDismiss, onSelect }: {
  onDismiss: () => void;
  onSelect: (signal: "new_sharp_pain" | "chest_discomfort" | "dizziness_or_fainting" | "unusual_breathing_difficulty" | "known_constraint") => void;
}) {
  const choices: readonly { signal: "new_sharp_pain" | "chest_discomfort" | "dizziness_or_fainting" | "unusual_breathing_difficulty" | "known_constraint"; label: string }[] = [
    { signal: "new_sharp_pain", label: "出现新的锐痛" },
    { signal: "chest_discomfort", label: "胸部不适" },
    { signal: "dizziness_or_fainting", label: "头晕或接近晕厥" },
    { signal: "unusual_breathing_difficulty", label: "异常呼吸困难" },
    { signal: "known_constraint", label: "已有专业限制需要遵守" },
  ];
  return <View accessibilityViewIsModal style={styles.safetyPauseScrim}>
    <Pressable accessibilityRole="button" accessibilityLabel="关闭安全暂停" onPress={onDismiss} style={StyleSheet.absoluteFill} />
    <View style={styles.safetyPauseSheet}>
      <View style={styles.sheetHandle} />
      <Text style={styles.cardEyebrow}>训练安全</Text>
      <Text style={styles.safetyPauseTitle}>先暂停，再决定下一步</Text>
      <Text style={styles.safetyPauseDetail}>这不会诊断原因，也不会替你继续训练。选择后会冻结当前训练的自动推进。</Text>
      {choices.map((choice) => <Pressable key={choice.signal} accessibilityRole="button" onPress={() => onSelect(choice.signal)} style={styles.safetyPauseChoice}><Text style={styles.safetyPauseChoiceText}>{choice.label}</Text><Text style={styles.chevron}>›</Text></Pressable>)}
      <Pressable accessibilityRole="button" onPress={onDismiss} style={styles.safetyPauseCancel}><Text style={styles.safetyPauseCancelText}>返回训练</Text></Pressable>
    </View>
  </View>;
}

/**
 * A task-focused editor rather than a copy of the plan screen.  It can only
 * operate on the persisted WorkoutSession's unstarted portion; the domain
 * command owns all freeze and identity checks again at commit time.
 */
function WorkoutTaskEditor({
  application,
  cloudConfirmed,
  userId,
  workout,
  onDismiss,
  onChanged,
}: {
  application: CoachApplication;
  cloudConfirmed: ConfirmedProductBridge;
  userId: string;
  workout: Awaited<ReturnType<CoachApplication["readWorkoutSession"]>>;
  onDismiss: () => void;
  onChanged: () => void;
}) {
  const [query, setQuery] = useState("");
  const [selectedTaskId, setSelectedTaskId] = useState<string>();
  const [selectedExerciseId, setSelectedExerciseId] = useState<string>();
  const [setCount, setSetCount] = useState("1");
  const [targetValue, setTargetValue] = useState("10");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [saveState, setSaveState] = useState<"idle" | "saving" | "failed" | "conflict">("idle");
  const completed = useMemo(
    () => new Set([
      ...workout.setOutcomes.map((outcome) => outcome.prescriptionSetId),
      ...(workout.skippedSets ?? []).map((skipped) => skipped.prescriptionSetId),
    ]),
    [workout.setOutcomes, workout.skippedSets],
  );
  const drafted = useMemo(
    () => new Set(workout.drafts.map((draft) => draft.prescriptionSetId)),
    [workout.drafts],
  );
  const editableTasks = workout.frozenPrescription.tasks.filter(
    (task) => task.sets.some((set) => !completed.has(set.id) && !drafted.has(set.id)),
  );
  const candidates = application.searchExerciseCatalog({ query, limit: 6 });
  const selectedExercise = selectedExerciseId
    ? candidates.find((candidate) => candidate.id === selectedExerciseId) ??
      application.searchExerciseCatalog({ query: selectedExerciseId, limit: 1 })[0]
    : undefined;
  const commit = async (
    change: Parameters<CoachApplication["editUpcomingWorkoutPlan"]>[0]["change"],
    reason: string,
  ) => {
    setBusy(true);
    setSaveState("saving");
    try {
      const key = `mobile-workout:${workout.id}:task-edit:${workout.revision}:${change.kind}:${selectedTaskId ?? selectedExerciseId ?? "none"}`;
      await cloudConfirmed.updateWorkoutThen({
        localWorkoutId: workout.id,
        patch: { data: { latestRouteChange: { change, reason, expectedLocalRevision: workout.revision } } },
        idempotencyKey: `${key}:cloud`,
        commitLocal: () => application.editUpcomingWorkoutPlan({
          userId,
          workoutId: workout.id,
          change,
          reason,
          idempotencyKey: key,
        }),
      });
      setError(undefined);
      setSaveState("idle");
      onChanged();
      onDismiss();
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : "无法更新尚未开始的动作";
      const conflict = /conflict|revision/i.test(detail);
      setSaveState(conflict ? "conflict" : "failed");
      setError(conflict ? "云端版本有冲突，路线没有保存。请刷新后再试。" : "云端尚未确认，路线没有保存。可以重试。");
    } finally {
      setBusy(false);
    }
  };
  const add = async () => {
    if (!selectedExercise) {
      setError("先从动作库选择一个动作。");
      return;
    }
    const count = optionalFiniteNumber(setCount);
    const value = optionalFiniteNumber(targetValue);
    if (!count || !Number.isInteger(count) || count < 1 || count > 12) {
      setError("组数需要是 1 到 12 的整数。");
      return;
    }
    if (value === undefined || value <= 0) {
      setError("请填写每组的目标次数、时长或距离。");
      return;
    }
    const identity = selectedExercise.identity.loadMeasurement;
    if (identity === "none") {
      setError("这个动作没有可执行的组级计量；请通过当天活动记录保存实际经历。");
      return;
    }
    const taskId = `session-task:${workout.id}:${selectedExercise.id}:${workout.revision}`;
    const sets = Array.from({ length: count }, (_, index) => ({
      id: `${taskId}:set:${index + 1}`,
      ...(identity === "time"
        ? { targetDuration: { value, unit: "seconds" as const } }
        : identity === "distance"
          ? { targetDistance: { value, unit: "m" as const } }
          : { targetReps: { min: Math.max(1, Math.floor(value)), max: Math.max(1, Math.floor(value)) } }),
    }));
    await commit({
      kind: "add_task",
      task: {
        id: taskId,
        exerciseVariantId: selectedExercise.id,
        mode: identity === "time" ? "timed" : identity === "distance" ? "distance" : identity === "bodyweight_node" ? "bodyweight_reps" : "weighted_reps",
        sets,
      },
    }, "user_added_unstarted_task");
    setSelectedExerciseId(undefined);
    setQuery("");
  };
  const replace = async () => {
    if (!selectedTaskId || !selectedExercise) {
      setError("先选择要替换的后续动作和新的动作。");
      return;
    }
    const selectedTask = workout.frozenPrescription.tasks.find((task) => task.id === selectedTaskId)!;
    const hasLockedSet = selectedTask.sets.some((set) => completed.has(set.id) || drafted.has(set.id));
    await commit(hasLockedSet ? {
      kind: "replace_remaining_task",
      taskId: selectedTaskId,
      replacementTaskId: `${selectedTaskId}:replacement:${workout.revision}`,
      replacementExerciseVariantId: selectedExercise.id,
    } : {
      kind: "replace_task_exercise",
      taskId: selectedTaskId,
      replacementExerciseVariantId: selectedExercise.id,
    }, "user_selected_temporary_substitution");
    setSelectedExerciseId(undefined);
  };
  return (
    <View style={styles.exerciseManagerScrim}>
      <View style={styles.exerciseManagerSheet}>
        <View style={styles.sheetHandle} />
        <View style={styles.exerciseManagerHeader}>
          <View style={styles.exerciseManagerHeaderCopy}><Text style={styles.logTitle}>后续动作</Text><Text style={styles.exerciseManagerSub}>已完成或正在记录的组保持不变。更换动作不会沿用原动作的目标重量。</Text></View>
          <Pressable accessibilityRole="button" accessibilityLabel="关闭后续动作管理" onPress={onDismiss} style={styles.exerciseClose}><Text style={styles.exerciseCloseText}>完成</Text></Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.exerciseManagerScroll} keyboardShouldPersistTaps="handled">
          <Text style={styles.exerciseFieldLabel}>尚未开始</Text>
          {editableTasks.length ? editableTasks.map((task) => {
            const originalIndex = workout.frozenPrescription.tasks.findIndex((candidate) => candidate.id === task.id);
            return <View key={task.id} style={[styles.workoutTaskEditorRow, selectedTaskId === task.id && styles.workoutTaskEditorRowSelected]}>
              <Pressable accessibilityRole="radio" accessibilityState={{ selected: selectedTaskId === task.id }} onPress={() => setSelectedTaskId(task.id)} style={styles.workoutTaskEditorPrimary}><Text style={styles.workoutTaskTitle}>{exerciseDisplayName(task.exerciseVariantId)}</Text><Text style={styles.exerciseManagerSub}>{task.sets.length} 组 · 可替换、排序或移除</Text></Pressable>
              <View style={styles.workoutTaskEditorActions}>
                <Pressable accessibilityRole="button" disabled={busy || originalIndex <= 0} onPress={() => void commit({ kind: "reorder_task", taskId: task.id, toIndex: originalIndex - 1 }, "user_reordered_unstarted_task")} style={styles.workoutTaskTiny}><Text style={styles.workoutTaskTinyText}>上移</Text></Pressable>
                <Pressable accessibilityRole="button" disabled={busy || originalIndex >= workout.frozenPrescription.tasks.length - 1} onPress={() => void commit({ kind: "reorder_task", taskId: task.id, toIndex: originalIndex + 1 }, "user_reordered_unstarted_task")} style={styles.workoutTaskTiny}><Text style={styles.workoutTaskTinyText}>下移</Text></Pressable>
                <Pressable accessibilityRole="button" disabled={busy} onPress={() => void commit({ kind: "remove_task", taskId: task.id }, "user_removed_unstarted_task")} style={styles.workoutTaskTiny}><Text style={styles.exerciseArchiveText}>移除</Text></Pressable>
              </View>
            </View>;
          }) : <Text style={styles.exerciseEmpty}>当前没有可编辑的后续动作。已开始的训练内容会保持原样。</Text>}
          <View style={styles.workoutTaskPicker}>
            <Text style={styles.exerciseFieldLabel}>从动作库选择</Text>
            <TextInput accessibilityLabel="搜索动作库" value={query} onChangeText={setQuery} style={styles.logInput} placeholder="搜索动作" placeholderTextColor="#777971" />
            <View style={styles.workoutCatalogList}>{candidates.map((candidate) => <Pressable key={candidate.id} accessibilityRole="radio" accessibilityState={{ selected: selectedExerciseId === candidate.id }} onPress={() => setSelectedExerciseId(candidate.id)} style={[styles.workoutCatalogRow, selectedExerciseId === candidate.id && styles.workoutCatalogRowSelected]}><Text style={styles.exerciseRowTitle}>{candidate.displayName.zh}</Text><Text style={styles.exerciseManagerSub}>{candidate.identity.loadMeasurement === "time" ? "计时" : candidate.identity.loadMeasurement === "distance" ? "距离" : candidate.identity.loadMeasurement === "bodyweight_node" ? "徒手" : "重量 / 次数"}</Text></Pressable>)}</View>
            {selectedExercise ? <Text style={styles.workoutTaskBoundary}>新加入的动作不预填重量；请在记录前确认实际负荷。</Text> : null}
            <View style={styles.workoutTaskAddFields}><LightNumberInput label="组数" value={setCount} onChange={setSetCount} /><LightNumberInput label={selectedExercise?.identity.loadMeasurement === "time" ? "秒" : selectedExercise?.identity.loadMeasurement === "distance" ? "米" : "次数"} value={targetValue} onChange={setTargetValue} /></View>
            <View style={styles.workoutTaskButtons}><Pressable accessibilityRole="button" disabled={busy} onPress={() => void replace()} style={styles.workoutTaskSecondary}><Text style={styles.workoutTaskSecondaryText}>替换所选动作</Text></Pressable><Pressable accessibilityRole="button" disabled={busy} onPress={() => void add()} style={[styles.logSave, styles.workoutTaskAddButton, busy && styles.primaryButtonDisabled]}><Text style={styles.logSaveText}>添加到本次训练</Text></Pressable></View>
          </View>
      {saveState === "saving" ? <Text style={styles.workoutTaskBoundary}>正在等待云端确认…</Text> : null}
      {error ? <Text style={styles.formError}>{error}</Text> : null}
        </ScrollView>
      </View>
    </View>
  );
}

function PausedWorkoutScreen({ application, cloudConfirmed, userId, workoutId, reason, onFinished, onResumed }: { application: CoachApplication; cloudConfirmed: ConfirmedProductBridge; userId: string; workoutId: string; reason?: "user" | "safety" | "background" | "schedule"; onFinished: () => void; onResumed: () => void }) {
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const resume = async () => {
    setBusy(true);
    try {
      const result = await cloudConfirmed.updateWorkoutThen({
        localWorkoutId: workoutId,
        patch: { data: { lifecycle: "resumed", acknowledgedSafetyPause: reason === "safety" } },
        idempotencyKey: `mobile-workout:${workoutId}:resume:cloud`,
        commitLocal: () => application.resumeWorkoutSession({
          userId,
          workoutId,
          acknowledgeSafetyPause: reason === "safety",
          idempotencyKey: `mobile-workout:${workoutId}:resume`,
        }),
      });
      if (result.status === "partial_proposal") {
        setError("间隔已超过本次训练的恢复窗口；可以结束为未完成，或回到今天重新安排。");
        return;
      }
      onResumed();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "暂时无法继续训练"); }
    finally { setBusy(false); }
  };
  const finishPartial = async () => {
    setBusy(true);
    try {
      await cloudConfirmed.completeWorkoutThen({
        localWorkoutId: workoutId,
        summary: { status: "partial", pauseReason: reason ?? "unknown" },
        completedAt: new Date().toISOString(),
        idempotencyKey: `mobile-workout:${workoutId}:finish-paused:cloud`,
        commitLocal: () => application.completeWorkoutSession({
          userId,
          workoutId,
          status: "partial",
          idempotencyKey: `mobile-workout:${workoutId}:finish-paused`,
        }),
      });
      onFinished();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "暂时无法结束训练"); }
    finally { setBusy(false); }
  };
  const title = reason === "safety" ? "先暂停一下" : "训练已暂停";
  const detail = reason === "safety"
    ? "这是非诊断性的暂停。请根据自身情况决定是否继续；如有需要，请寻求合适的专业帮助。"
    : "当前进度和休息计时都已保存在本机。恢复后会回到同一组。";
  return <View style={styles.pausedPage}><View style={styles.pausedCard}><Text style={styles.cardEyebrow}>训练 Session</Text><Text style={styles.pausedTitle}>{title}</Text><Text style={styles.pausedDetail}>{detail}</Text>{error ? <Text style={styles.formError}>{error}</Text> : null}<Pressable accessibilityRole="button" disabled={busy} onPress={() => void resume()} style={[styles.primaryButton, busy && styles.primaryButtonDisabled]}><Text style={styles.primaryButtonText}>{reason === "safety" ? "确认后继续" : "继续训练"}</Text></Pressable><Pressable accessibilityRole="button" disabled={busy} onPress={() => void finishPartial()} style={styles.finishButton}><Text style={styles.finishButtonText}>结束并保留已完成内容</Text></Pressable></View></View>;
}

function ActualInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <View style={styles.actualField}><Text style={styles.actualLabel}>{label}</Text><TextInput accessibilityLabel={`实际${label}`} keyboardType="decimal-pad" value={value} onChangeText={onChange} style={styles.actualInput} placeholder="—" placeholderTextColor="#777971" /></View>;
}

function LightNumberInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <View style={styles.workoutTaskNumberField}><Text style={styles.workoutTaskNumberLabel}>{label}</Text><TextInput accessibilityLabel={label} keyboardType="decimal-pad" value={value} onChangeText={onChange} style={styles.workoutTaskNumberInput} placeholder="—" placeholderTextColor="#777971" /></View>;
}

function PlanSession({ session, subdued = false }: { session: ProductSession; subdued?: boolean }) {
  return <View style={[styles.planSession, subdued && styles.planSessionSubdued]}><Text style={styles.planSessionDate}>{shortDate(session.scheduledFor)}</Text><View style={styles.planSessionBody}><Text style={styles.planSessionTitle}>{readablePlanSessionTitle(session.title)}</Text><Text style={styles.planSessionMeta}>{sessionMeta(session)}</Text></View><Text style={styles.chevron}>›</Text></View>;
}

function DetailedPlanSession({ session, subdued = false }: { session: ProductSession; subdued?: boolean }) {
  const rest = session.kind === "rest" || session.kind === "recovery" || session.taskCount === 0;
  if (rest) return <View style={[styles.committedRestDay, subdued && styles.planSessionSubdued]}><Text style={styles.committedRestDate}>{weekdayAndDate(session.scheduledFor)}</Text><Text style={styles.committedRestTitle}>恢复与记录</Text><Text style={styles.committedRestMeta}>保持日常活动；可补记睡眠、疲劳或饮食</Text></View>;
  return <View style={[styles.reportSessionCard, subdued && styles.planSessionSubdued]}>
    <View style={styles.reportSessionTop}><View><Text style={styles.reportSessionDate}>{weekdayAndDate(session.scheduledFor)}</Text><Text style={styles.reportSessionTitle}>{readablePlanSessionTitle(session.title)}</Text></View><Text style={styles.committedSessionSets}>{session.totalSetCount} 组</Text></View>
    <View style={styles.reportTaskList}>{session.actions.map((task) => <View key={task.id} style={styles.reportTaskRow}><View style={styles.reportTaskBullet} /><Text numberOfLines={1} style={styles.reportTaskName}>{humanizeExerciseLabel(task.label)}</Text><Text style={styles.reportTaskDose}>{humanizeDoseSummary(task.summary)}{task.targetRir !== undefined ? ` · 余力 ${task.targetRir}` : ""}</Text></View>)}</View>
    {session.aerobicBlock ? <View style={styles.reportAerobicBlock}><Text style={styles.reportAerobicTitle}>{session.aerobicBlock.placement === "after_strength" ? "力量完成后有氧" : "独立有氧"} · {session.aerobicBlock.minutes} 分钟</Text><Text style={styles.reportAerobicCopy}>RPE {session.aerobicBlock.targetRpe.min}–{session.aerobicBlock.targetRpe.max} · {session.aerobicBlock.talkTest} {session.aerobicBlock.fastedEligible ? "空腹仅是偏好选项。" : "本计划不安排空腹有氧。"}</Text>{session.aerobicBlock.safetyNote ? <Text style={styles.reportAerobicGuard}>{session.aerobicBlock.safetyNote}</Text> : null}</View> : null}
    <Text style={styles.reportSessionFoot}>{session.estimatedMinutes ? `预计 ${session.estimatedMinutes} 分钟` : "按完成质量调整时长"} · 先保证动作质量，再考虑加量</Text>
  </View>;
}

function Metric({ value, label }: { value: string; label: string }) { return <View style={styles.metric}><Text style={styles.metricValue}>{value || "—"}</Text><Text style={styles.metricLabel}>{label}</Text></View>; }
function ProgressMetric({ label, value, meta }: { label: string; value: string; meta: string }) { return <View style={styles.progressMetric}><Text style={styles.progressMetricValue}>{value}</Text><Text style={styles.progressMetricLabel}>{label}</Text><Text style={styles.progressMetricMeta}>{meta}</Text></View>; }
function ProfileRow({ label, value }: { label: string; value: string }) { return <View style={styles.profileRow}><Text style={styles.profileLabel}>{label}</Text><Text style={styles.profileValue}>{value}</Text></View>; }
function CoachPending({ prompt }: { prompt: string }) { return <View style={styles.pendingCard}><Text style={styles.pendingLabel}>等待确认</Text><Text style={styles.pendingText}>{prompt}</Text></View>; }
function Empty({ label, compact = false }: { label: string; compact?: boolean }) { return <View style={[styles.empty, compact && styles.emptyCompact]}><Text style={styles.emptyText}>{label}</Text></View>; }
function LoadingState() { return <View style={styles.statePage}><ActivityIndicator color={colors.limeDeep} /><Text style={styles.stateText}>正在读取本地资料</Text></View>; }
function ErrorState({ message, onRetry, title = "暂时无法打开资料", retryLabel = "重试" }: { message: string; onRetry: () => void; title?: string; retryLabel?: string }) { return <View style={styles.statePage}><Text style={styles.stateTitle}>{title}</Text><Text style={styles.stateText}>{message}</Text><Pressable accessibilityRole="button" onPress={onRetry} style={styles.retry}><Text style={styles.retryText}>{retryLabel}</Text></Pressable></View>; }

function routeContext(route: ProductRoute): CoachContextKind {
  if (route === "onboarding") return "onboarding";
  if (route === "plan") return "plan";
  if (route === "profile") return "profile";
  if (route === "video_library" || route === "replay") return "progress";
  return route;
}

function localDate(): string { return new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10); }
/** Compatibility helper retained for adapters that only emit the old trio. */
export function resolveNotificationDeepLink(value?: string): { route: "today" | "progress" | "workout"; ref: string } | undefined {
  const intent = resolveMaxPowerDeepLink(value);
  if (!intent || intent.route === "calendar" || intent.route === "plan" || intent.route === "profile") return undefined;
  if (intent.route === "workout") return { route: "workout", ref: intent.workoutId };
  if (intent.route === "today" || intent.route === "progress") {
    return { route: intent.route, ref: intent.date };
  }
  return undefined;
}
function isProductDeepLinkRoute(route: ProductRoute): route is ProductDeepLinkRoute {
  return route === "today" || route === "calendar" || route === "plan" || route === "progress" || route === "profile" || route === "workout";
}
function isPrimaryProductRoute(route: string): route is PrimaryProductRoute {
  return route === "today" || route === "calendar" || route === "plan" || route === "profile";
}
function sameCoachContext(left: ContextRef, right: ContextRef): boolean {
  return left.kind === right.kind && left.ref === right.ref;
}
function contextAcceptsRestoredCoach(saved: ContextRef, current: ContextRef, projectionPending: boolean): boolean {
  // The Plan context contains its materialized revision, which is unavailable
  // during the first projection read. Preserve a saved Plan attachment until
  // that exact revision can be checked; no other context gets this exception.
  return sameCoachContext(saved, current) || (projectionPending && saved.kind === "plan" && current.kind === "plan");
}
function shiftCalendarDate(date: string, days: number): string { const next = new Date(`${date}T12:00:00.000Z`); next.setUTCDate(next.getUTCDate() + days); return next.toISOString().slice(0, 10); }
function shiftCalendarMonth(date: string, months: number): string { const [year, month, day] = date.split("-").map(Number); const first = new Date(Date.UTC(year!, month! - 1 + months, 1, 12)); const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate(); first.setUTCDate(Math.min(day!, lastDay)); return first.toISOString().slice(0, 10); }
function shortDate(date: string): string { const [, month, day] = date.split("-"); return `${Number(month)} 月 ${Number(day)} 日`; }
function localDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日 ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function sessionMeta(session: ProductSession): string { return `${session.kind === "cardio" ? "有氧" : session.kind === "rest" || session.kind === "recovery" ? "恢复" : "训练"}${session.estimatedMinutes ? ` · ${session.estimatedMinutes} 分钟` : ""}${session.taskCount ? ` · ${session.taskCount} 项` : ""}`; }
function weekdayAndDate(date: string): string { const weekday = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][new Date(`${date}T12:00:00.000Z`).getUTCDay()]; return `${weekday} · ${shortDate(date)}`; }
function readablePlanSessionTitle(title: string): string { return title.replace("hypertrophy", "增肌").replace("strength", "力量").replace("fat_loss_preserve_lean_mass", "减脂保肌"); }
function humanizeExerciseLabel(label: string): string {
  const tokenLabels: Record<string, string> = {
    band: "弹力带",
    barbell: "杠铃",
    bodyweight: "徒手",
    cable: "绳索",
    cardio_machine: "有氧器械",
    dumbbell: "哑铃",
    kettlebell: "壶铃",
    machine: "固定器械",
    none: "无器械",
    conventional: "传统式",
    breathing: "呼吸练习",
    body_saw: "身体锯",
    brisk: "快走",
    ankle: "踝部",
    incline: "上斜",
    decline: "下斜",
    easy: "轻松",
    easy_walk: "轻松步行",
    elbow_at_side: "肘贴体侧",
    forward: "前跨式",
    full_body: "全身",
    gentle_stretch: "轻柔拉伸",
    half_kneeling: "半跪姿",
    hip: "髋部",
    in_place: "原地",
    interval: "间歇",
    knee: "膝撑",
    knee_raise: "提膝",
    kneeling: "跪姿",
    lateral: "侧向",
    lean_away: "侧倾式",
    long_lever: "长杠杆",
    lying: "卧姿",
    ninety_degree: "90 度",
    overhead: "过顶式",
    paused: "停顿式",
    pushdown: "下压式",
    recumbent: "卧式",
    rear_foot_elevated: "后脚抬高",
    reverse: "后撤式",
    rest: "休息",
    rope: "绳索式",
    romanian: "罗马尼亚式",
    seated: "坐姿",
    side_left: "左侧",
    side_right: "右侧",
    spin: "动感单车",
    steady: "稳态",
    standing: "站姿",
    step_jack: "开合踏步",
    shoulder: "肩部",
    thoracic: "胸椎",
    walking: "行走式",
    wrist: "腕部",
    upright: "直立式",
  };
  return label
    .split(" · ")
    .filter((token) => token !== "standard")
    .map((token) => tokenLabels[token] ?? token)
    .join(" · ");
}
function humanizeDoseSummary(summary: string): string {
  return summary
    .replace(/\bminutes?\b/g, "分钟")
    .replace(/\bseconds?\b/g, "秒")
    .replace(/\bhours?\b/g, "小时")
    .replace(/\breps?\b/g, "次");
}
function exerciseDisplayName(id: string): string {
  const prefix = id.split(".")[0];
  return ({
    anti_rotation_press: "抗旋推",
    bench_press: "卧推",
    biceps_curl: "肱二头弯举",
    calf_raise: "提踵",
    chest_fly: "飞鸟",
    crunch: "卷腹",
    cycle: "骑行",
    deadlift: "硬拉",
    elliptical: "椭圆机",
    external_rotation: "肩外旋",
    front_raise: "前平举",
    hip_thrust: "臀桥 / 髋推",
    knee_extension: "腿屈伸",
    knee_flexion: "腿弯举",
    lat_pulldown: "高位下拉",
    lateral_raise: "侧平举",
    leg_press: "腿举",
    lunge: "弓步",
    march: "踏步",
    mobility_flow: "灵活性活动",
    overhead_press: "肩上推举",
    plank: "平板支撑",
    push_up: "俯卧撑",
    pull_up: "引体向上",
    rear_delt_fly: "后束飞鸟",
    recovery_activity: "恢复活动",
    row: "划船",
    split_squat: "分腿蹲",
    inverted_row: "反向划船",
    squat: "深蹲",
    stair_climb: "爬楼",
    straight_arm_pulldown: "直臂下压",
    triceps_extension: "肱三头伸展",
    walk: "步行",
    romanian_deadlift: "罗马尼亚硬拉",
    shoulder_press: "肩上推举",
  } as Record<string, string>)[prefix] ?? id.replace(/[._-]+/g, " ");
}
function planTaskDose(task: import("../../coach/domain").PlannedExerciseTask): string {
  const first = task.sets[0];
  if (!first) return "待校准";
  const target = first.targetReps
    ? `${first.targetReps.min === first.targetReps.max ? first.targetReps.min : `${first.targetReps.min}–${first.targetReps.max}`} 次`
    : first.targetDuration
      ? `${first.targetDuration.value} ${first.targetDuration.unit === "seconds" ? "秒" : first.targetDuration.unit === "minutes" ? "分钟" : "小时"}`
      : first.targetDistance
        ? `${first.targetDistance.value} ${first.targetDistance.unit}`
        : "待校准";
  const rest = first.rest
    ? first.rest.unit === "seconds"
      ? `${first.rest.value} 秒`
      : `${first.rest.value} 分钟`
    : undefined;
  return `${task.sets.length} × ${target}${first.targetRir !== undefined ? ` · 余力约 ${first.targetRir}` : ""}${rest ? ` · 休息 ${rest}` : ""}`;
}
function outcomeStatusLabel(status: WorkoutOutcomeProductSummary["status"]): string { return status === "completed" ? "已完成" : status === "partial" ? "部分完成" : "已中止"; }
function outcomeCompletenessLabel(value: WorkoutOutcomeProductSummary["dataCompleteness"]): string { return value === "complete" ? "记录完整" : value === "partial" ? "部分记录" : "手动记录"; }
function trendValue(value: number | undefined, unit: string | undefined): string { return value === undefined ? "—" : `${value.toFixed(1)}${unit === "percent" ? "%" : unit ?? ""}`; }
function trendCoverage(count: number | undefined): string { return count ? `${count} 条可比记录` : "记录不足"; }
function metricLabel(name: string): string { return { body_trend: "身体趋势", training_trend: "训练趋势", nutrition_adherence: "营养执行", recovery_trend: "恢复趋势", phase_progress: "阶段进度", goal_feasibility: "目标可行性" }[name] ?? name; }
function metricDirectionLabel(direction: string, score?: number): string { if (direction === "improving") return score === undefined ? "改善" : `改善 ${score.toFixed(2)}`; if (direction === "declining") return score === undefined ? "下降" : `下降 ${Math.abs(score).toFixed(2)}`; if (direction === "stable") return "稳定"; return "待积累"; }
function metricConfidenceLabel(confidence: string): string { return confidence === "high" ? "高信心" : confidence === "moderate" ? "中信心" : "低信心"; }
function nutritionDayKindLabel(kind: DailyIntakeBudget["dayKind"]): string { return kind === "training" ? "训练日" : kind === "rest" ? "休息日" : kind === "deload" ? "减量日" : kind === "recovery" ? "恢复日" : "类型待确认"; }
function intakePalette(status: DailyIntakeStatus): { color: string; soft: string; ink: string } {
  if (status === "on_track") return { color: colors.fuelSafe, soft: colors.fuelSafeSoft, ink: "#476D0C" };
  if (status === "slightly_over" || status === "below" || status === "far_below") return { color: colors.fuelWarn, soft: colors.fuelWarnSoft, ink: "#805500" };
  if (status === "high") return { color: colors.fuelDanger, soft: colors.fuelDangerSoft, ink: "#9F2B20" };
  return { color: colors.ink3, soft: colors.paper2, ink: colors.ink2 };
}
function intakeStatusLabel(budget: DailyIntakeBudget): string {
  if (budget.status === "unknown") return "待记录";
  if (budget.status === "on_track") return "正常范围";
  const variance = budget.variancePercent ?? 0;
  return variance < 0 ? `低 ${Math.abs(variance)}%` : `高 ${variance}%`;
}
function intakeExplanation(budget: DailyIntakeBudget): { title: string; body: string } {
  const magnitude = Math.abs(budget.variancePercent ?? 0);
  if (budget.status === "unknown") {
    const partial = budget.missing.includes("unquantified_meal");
    return {
      title: partial ? "有餐食尚未量化" : "还不能判断吃多或吃少",
      body: partial ? "已有餐食没有完整份量或热量，系统会保持未知，不把缺失值当成零。补齐后圆环才会判断区间。" : "未记录不等于摄入为零。记录餐食后，圆环会按今天的训练与运动预算显示正常、偏高或偏低。",
    };
  }
  if (budget.status === "far_below") return { title: `当前记录明显偏低 · 少 ${magnitude}%`, body: "如果今天已接近结束，建议补足一餐或加餐。长期明显少吃会影响训练表现、恢复和瘦体重；减脂也不是越少越好。" };
  if (budget.status === "below") return { title: `还没进入建议区间 · 少 ${magnitude}%`, body: "今天仍低于建议下限。若还有正餐，优先补蛋白质、主食和正常份量，不需要用挨饿换取更快进度。" };
  if (budget.status === "on_track") return { title: "处于建议摄入 ±10%", body: "圆环为绿色表示今天已在可执行区间。维持规律进餐即可，不必为了精确到个位数继续加减。" };
  if (budget.status === "slightly_over") return { title: `黄色提醒 · 高 ${magnitude}%`, body: "今天比建议值高出 10% 以上。先停止额外加餐，下一餐按饥饿感和蛋白质目标安排；明天回到原计划，不做惩罚性少吃。" };
  return { title: `红色提醒 · 高 ${magnitude}%`, body: "今天比建议值高出 20% 以上。把它作为一次可复盘的记录，留意饮料、零食和份量；不要用第二天极端断食补偿。" };
}
function intakeAdjustmentSummary(budget: DailyIntakeBudget): string {
  const parts = [
    budget.dayTypeAdjustmentKcal ? `${nutritionDayKindLabel(budget.dayKind)} ${signedKcal(budget.dayTypeAdjustmentKcal)}` : undefined,
    budget.activityAdjustmentKcal ? `运动 ${signedKcal(budget.activityAdjustmentKcal)}` : undefined,
  ].filter((part): part is string => Boolean(part));
  return parts.length ? parts.join(" · ") : "按本周训练安排动态分配";
}
function signedKcal(value: number): string { return `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toLocaleString()} kcal`; }
function weekDayLabel(date: string): string { return ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][new Date(`${date}T12:00:00.000Z`).getUTCDay()] ?? ""; }
function dateDistance(from: string, to: string): number { return Math.round((Date.parse(`${to}T12:00:00.000Z`) - Date.parse(`${from}T12:00:00.000Z`)) / 86_400_000); }
function recoveryLevelLabel(level: CoachProductProjection["today"]["recovery"]["level"]): string { return level === "normal" ? "按原计划" : level === "slight_reduction" ? "稍微放缓" : level === "recovery_priority" ? "恢复优先" : "暂停并确认"; }
function clampNumber(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)); }
function goalLabel(value?: string): string { return value === "hypertrophy" ? "增肌" : value === "strength" ? "增力" : value === "fat_loss_preserve_lean_mass" ? "减脂保肌" : "待填写"; }
function experienceLabel(value?: string): string { return value === "beginner" ? "刚开始训练" : value === "intermediate" ? "规律训练" : value === "advanced" ? "进阶训练" : "训练经验待补充"; }
function recoveryReasonLabel(value: string, locale?: string): string {
  return ({
    no_active_recovery_constraint: "当前没有恢复限制",
    check_in_optional: "睡眠、疲劳与酸痛（可选）",
    recovery_check_in_missing: "尚未记录恢复感受",
    sleep_missing: "尚未记录睡眠",
  } as Record<string, string>)[value] ?? planningPhrase(value, locale).replaceAll("_", " ");
}
function movementLabel(value?: MovementPattern): string { return movementChoices.find((choice) => choice.value === value)?.label ?? "未分类"; }
function mandateLabel(value?: string): string { return value === "manual" ? "手动" : value === "managed" ? "托管" : value === "collaborative" ? "协作" : "待选择"; }
function permissionLabel(value: string): string { return value === "granted" ? "已允许" : value === "denied" ? "未允许" : "未设置"; }
function privacyAccountLabel(_overview: PrivacySettingsOverviewValue): string {
  return "已登录 MaxPower";
}
function privacyAccountDetail(_overview: PrivacySettingsOverviewValue): string {
  return "当前产品运行时已由在线账号验证；本机缓存、界面状态与后台任务均按此账号隔离。";
}
function privacySyncLabel(overview: PrivacySettingsOverviewValue): string {
  if (overview.sync.authorization !== "granted") return overview.sync.authorization === "denied" ? "已关闭" : "未启用";
  if (overview.sync.status === "synchronized") return "已同步";
  if (overview.sync.status === "pending_upload") return overview.sync.pendingChanges ? `${overview.sync.pendingChanges} 项待同步` : "等待同步";
  if (overview.sync.status === "conflict") return "需要处理";
  if (overview.sync.status === "retry_needed") return "等待重试";
  if (overview.sync.status === "rejected") return "需要检查";
  if (overview.sync.status === "pending_dependency") return "等待资料";
  return overview.sync.capability === "available" ? "尚未同步" : "此设备未配置";
}
function privacySyncDetail(overview: PrivacySettingsOverviewValue): string {
  if (overview.sync.authorization !== "granted") return "同步尚未启用；本机资料继续独立保存，也不会发起同步请求。";
  if (overview.sync.status === "conflict") return `有 ${overview.sync.needsReview} 个版本分支需要你在原编辑流程中新建版本处理，系统不会自动选择其中一边。`;
  if (overview.sync.status === "retry_needed") return "上次同步未完成；会在可用时提供受控重试，最近一次成功时间会保留。";
  if (overview.sync.status === "synchronized") return overview.sync.lastSucceededAt ? `最近成功同步于 ${overview.sync.lastSucceededAt.slice(0, 16).replace("T", " ")}。` : "本地副本已与已连接设备一致。";
  if (overview.sync.status === "pending_upload") return "本地已有变更等待同步；训练记录在同步前后都保留在本机。";
  return overview.sync.capability === "available" ? "同步已允许，但还没有完成一次同步。" : "这台设备尚未配置同步服务。";
}
function privacyRemoteModelLabel(overview: PrivacySettingsOverviewValue): string {
  return overview.remoteModel.configuration.status === "managed_cloud" ? "已启用" : "不可用";
}
function privacyMediaLabel(overview: PrivacySettingsOverviewValue): string {
  if (overview.media.availability === "temporarily_unavailable") return "本机媒体暂时不可读取";
  if (overview.media.availability === "not_configured") return "未配置本机媒体存储";
  return overview.media.active.itemCount ? `本机媒体 ${overview.media.active.itemCount} 项 · ${formatByteCount(overview.media.active.byteLength)}` : "没有本机媒体";
}
function privacyMediaProtectionDetail(overview: PrivacySettingsOverviewValue): string {
  if (overview.media.availability === "temporarily_unavailable") return "无法读取本机存储状态；不会因此声明媒体已上传或已删除。";
  const { platformProtected, clientSideEncrypted, notEncrypted } = overview.media.encryption;
  const parts = [
    platformProtected ? `${platformProtected} 项受系统保护` : undefined,
    clientSideEncrypted ? `${clientSideEncrypted} 项使用客户端加密` : undefined,
    notEncrypted ? `${notEncrypted} 项当前未加密` : undefined,
  ].filter((part): part is string => Boolean(part));
  return parts.length ? parts.join("；") : "当前没有可用媒体。";
}
function formatByteCount(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function healthSourceLabel(platform: CoachProductProjection["profile"]["healthSources"][number]["platform"]): string { return platform === "health_connect" ? "Health Connect" : platform === "healthkit" ? "Apple 健康" : "手动健康记录"; }
function healthSourceSummary(source: CoachProductProjection["profile"]["healthSources"][number]): string {
  const sourceName = healthSourceLabel(source.platform);
  if (source.availability !== "available") {
    return source.availability === "provider_missing_or_update_required" ? `需要安装或更新 ${sourceName}` :
      source.availability === "not_supported" ? `当前设备不支持 ${sourceName}` :
      source.availability === "permission_not_requested" ? "尚未请求授权" :
      source.availability === "permission_denied_or_revoked" ? "授权已拒绝或撤销" :
      source.availability === "temporarily_unavailable" ? "暂时无法读取，保留已有记录" : "读取失败，保留已有记录";
  }
  const granted = source.grantedMetricTypes.length;
  const unknown = source.unknownPermissionMetricTypes.length;
  const metricText = unknown
    ? `${unknown}/${source.metricTypes.length} 项已请求读取`
    : `${granted}/${source.metricTypes.length} 项已授权`;
  const importedAt = source.lastSuccessfulImportAt ?? source.lastAttemptAt;
  return `${metricText} · ${importedAt.slice(5, 16)}`;
}
function healthConnectionStatus(availability: import("../../coach/model").HealthAdapterAvailability, granted: number, sourceName: string): string {
  if (availability === "available") return granted ? `已选择 ${granted} 项数据来源` : "还没有选择可读取的数据";
  if (availability === "provider_missing_or_update_required") return `需要安装或更新 ${sourceName}`;
  if (availability === "not_supported") return `当前设备不支持 ${sourceName}`;
  if (availability === "permission_not_requested") return "尚未请求系统读取权限";
  if (availability === "permission_denied_or_revoked") return "系统读取权限已拒绝或撤销";
  if (availability === "temporarily_unavailable") return "暂时无法连接；已有记录会保留";
  return "暂时无法读取；已有记录会保留";
}
function actionLabel(action: CoachProductProjection["profile"]["actionLog"]["recent"][number]["action"]): string { return action === "plan.change.applied" ? "已更新计划" : action === "plan.change.undone" ? "已撤销调整" : action === "plan.change.rejected" ? "保留原计划" : action === "proposal.created" ? "已生成建议" : action === "assessment.created" ? "已完成复核" : action === "fact.written" ? "已写入记录" : action === "timeline.corrected" ? "已更正记录" : action === "workout.corrected" ? "已更正训练记录" : action === "workout.set_skipped" ? "已跳过训练组" : action === "memory.changed" ? "已更新 Coach 记忆" : action === "permission.changed" ? "已更新授权" : "Coach 操作"; }
function actionResultLabel(result: CoachProductProjection["profile"]["actionLog"]["recent"][number]["result"]): string { return result === "applied" ? "已执行" : result === "undone" ? "已撤销" : result === "rejected" ? "已拒绝" : result === "allowed" ? "已记录" : "未完成"; }
function strategyLabel(strategy: string): string { return ({ fat_loss_recomposition: "减脂重组", preserve_lean_mass_cut: "保肌减脂", final_cut: "最后减脂", maintenance_recomposition: "维持重组", recovery_maintenance: "恢复维持", conservative_gain: "保守增肌", stable_strength_gain: "稳定增力", return_to_training: "停训回归", advanced_specialization_maintenance: "专项维持", post_loss_consolidation_gain: "减重后巩固", diet_break: "Diet break", deload_overlay: "Deload" } as Record<string, string>)[strategy] ?? strategy; }
function forecastScenarioLabel(scenario: "strict_aggressive" | "balanced" | "flexible"): string { return scenario === "strict_aggressive" ? "严格进取" : scenario === "balanced" ? "平衡" : "灵活"; }
function actorLabel(actor: "user" | "agent" | "rule_engine" | "sensor" | "sync"): string { return actor === "agent" ? "Coach" : actor === "rule_engine" ? "本地规则" : actor === "sensor" ? "设备" : actor === "sync" ? "同步" : "你"; }
function optionalFiniteNumber(value: string): number | undefined { const parsed = Number(value.trim()); return value.trim() && Number.isFinite(parsed) ? parsed : undefined; }

function onboardingGoalKind(draft: NonNullable<OnboardingEntryState["draft"]>): "fat_loss" | "hypertrophy" | "strength" | "visual_physique" | "general" {
  if (draft.patch.goalCapture?.goalTargets.some((target) => target.kind === "target_body_fat")) return "fat_loss";
  if (draft.patch.goalCapture?.visualIntents.length) return "visual_physique";
  const text = draft.patch.baseline?.goalNarrative?.text ?? "";
  if (/力量|卧推|深蹲|硬拉/u.test(text)) return "strength";
  if (/增肌|肌肉/u.test(text)) return "hypertrophy";
  return "general";
}

/** Convert only UI typing drafts into the catalog's typed command values. */
function dynamicFormValueToDomain(value: DynamicOnboardingFormValue): unknown {
  if (typeof value === "string") return value;
  if (Array.isArray(value) || value === undefined) return value;
  if ("amount" in value && "unit" in value) {
    return { value: Number(value.amount), unit: value.unit };
  }
  if ("start" in value && "end" in value) return { start: value.start, end: value.end };
  return Object.fromEntries(Object.entries(value).map(([key, nested]) => [
    key,
    key === "reps" || key === "rir_or_rpe" || key === "days_per_week" || key === "minutes_per_session"
      ? Number(nested)
      : dynamicFormValueToDomain(nested),
  ]));
}
function formatRestSeconds(seconds: number): string { return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`; }
function setDose(set: { targetReps?: { min: number; max: number }; targetDuration?: { value: number; unit: string }; targetDistance?: { value: number; unit: string }; targetLoad?: { value: number; unit: string }; targetRir?: number }): string {
  const volume = set.targetReps ? `${set.targetReps.min}–${set.targetReps.max} 次` : set.targetDuration ? `${set.targetDuration.value} ${set.targetDuration.unit}` : set.targetDistance ? `${set.targetDistance.value} ${set.targetDistance.unit}` : "待记录";
  return `${volume}${set.targetLoad ? ` · ${set.targetLoad.value} ${set.targetLoad.unit}` : ""}${set.targetRir !== undefined ? ` · RIR ${set.targetRir}` : ""}`;
}
function todayCopy(today: CoachProductProjection["today"]): { title: string; subtitle: string; empty: string; action: string } {
  if (today.state === "onboarding_required") return { title: "先建立资料", subtitle: "从基础信息开始，之后可随时补充", empty: "还没有生成训练任务", action: "开始建档" };
  if (today.state === "safety_hold") return { title: "先暂停安排", subtitle: today.reason ?? "需要先处理当前状态", empty: "不安排训练任务", action: "查看原因" };
  if (today.state === "planner_hold") return { title: "等待计划更新", subtitle: today.reason ?? "", empty: "不会用假任务填满今天", action: "查看原因" };
  if (today.state === "activity") return { title: today.session?.title ?? "今日活动", subtitle: "按自己的节奏完成", empty: "记录今天的活动", action: "记录活动" };
  if (today.state === "rest") return { title: today.session?.title ?? "恢复日", subtitle: "训练之外的经历也会被记录", empty: "记录恢复或活动", action: "记录今天" };
  if (today.state === "completed") return { title: today.session?.title ?? "今天已完成", subtitle: "训练结果已进入今日记录", empty: "查看完成摘要", action: "查看日报" };
  return { title: today.session?.title ?? "今日训练", subtitle: "按计划执行；下一组可以调整", empty: "", action: today.action === "continue_workout" ? "继续训练" : "开始训练" };
}

const styles = StyleSheet.create({
  logDrawerContent: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 32, gap: 12 },
  dockContent: { paddingBottom: 152 },
  todayKicker: { color: uiColors.limeDeep, fontSize: 9, fontWeight: "900", letterSpacing: 1.2, marginBottom: 3 },
  profileContent: { paddingTop: 24 },
  cardPressed: { opacity: 0.82, transform: [{ scale: 0.992 }] },
  profileLinkCard: { minHeight: 68, paddingHorizontal: 17, flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 20, backgroundColor: "#E5E1D7" },
  profileLinkTitle: { color: uiColors.ink, fontSize: 14, fontWeight: "900" },
  profileLinkMeta: { marginTop: 4, color: uiColors.inkMuted, fontSize: 10 },
  profileLinkArrow: { marginLeft: "auto", color: uiColors.ink, fontSize: 26 },
  planHeaderActions: { flexDirection: "row", gap: 7 },
  cycleHero: { padding: 22, borderRadius: 28, backgroundColor: uiColors.ink, gap: 6 },
  cycleHeroLabel: { marginTop: 13, color: "#A6AA9F", fontSize: 10, fontWeight: "800" },
  cycleHeroTitle: { color: uiColors.white, fontSize: 31, lineHeight: 36, fontWeight: "900", letterSpacing: -1 },
  cycleHeroCopy: { color: "#BFC3B7", fontSize: 11, fontFamily: "monospace" },
  cycleProgressRail: { height: 6, marginTop: 15, marginBottom: 8, flexDirection: "row", overflow: "hidden", borderRadius: 3, backgroundColor: "#2D312B" },
  cycleProgressFill: { backgroundColor: uiColors.lime },
  pendingPreviewCard: { minHeight: 92, padding: 17, flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 22, backgroundColor: uiColors.lime },
  pendingPreviewKicker: { color: "#536B00", fontSize: 9, fontWeight: "900", letterSpacing: 1.1 },
  pendingPreviewTitle: { marginTop: 5, color: uiColors.ink, fontSize: 16, fontWeight: "900" },
  pendingPreviewMeta: { marginTop: 4, color: "#535A42", fontSize: 10, lineHeight: 15 },
  pendingPreviewArrow: { marginLeft: "auto", color: uiColors.ink, fontSize: 28 },
  behaviorGrid: { gap: 9 },
  behaviorCard: { minHeight: 112 },
  behaviorTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  behaviorMark: { width: 25, height: 25, borderRadius: 9, textAlign: "center", textAlignVertical: "center", backgroundColor: uiColors.ink, color: uiColors.lime, fontSize: 11, fontWeight: "900", lineHeight: 25 },
  behaviorTitle: { color: uiColors.inkMuted, fontSize: 11, fontWeight: "800" },
  behaviorValue: { marginTop: 12, color: uiColors.ink, fontSize: 18, fontWeight: "900" },
  behaviorMeta: { marginTop: 5, color: uiColors.inkMuted, fontSize: 10, lineHeight: 15 },
  trendEntryCard: { minHeight: 118, padding: 20, flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 24, backgroundColor: "#E3DED1" },
  trendEntryKicker: { color: uiColors.limeDeep, fontSize: 9, fontWeight: "900", letterSpacing: 1.2 },
  trendEntryTitle: { marginTop: 6, color: uiColors.ink, fontSize: 21, fontWeight: "900" },
  trendEntryMeta: { maxWidth: 260, marginTop: 5, color: uiColors.inkMuted, fontSize: 10, lineHeight: 16 },
  trendEntryArrow: { marginLeft: "auto", color: uiColors.ink, fontSize: 28, fontWeight: "900" },
  nutritionRecommendationList: { gap: 7, marginTop: 8 },
  nutritionRecommendationRow: { backgroundColor: colors.paper2, borderRadius: 12, padding: 10, flexDirection: "row", alignItems: "center", gap: 8 },
  nutritionRecommendationBody: { flex: 1 },
  nutritionRecommendationTitle: { flex: 1, color: colors.ink, fontSize: 12, fontWeight: "800" },
  nutritionButtonRow: { flexDirection: "row", gap: 8, marginTop: 8 },
  nutritionSuggestButton: { flex: 1, minHeight: 42, borderRadius: radius.chip, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white, alignItems: "center", justifyContent: "center" },
  nutritionSuggestButtonText: { color: colors.ink, fontSize: 12, fontWeight: "800" },
  progressMetricList: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  progressMetricCompact: { width: "48%", minHeight: 78, backgroundColor: colors.white, borderRadius: radius.row, padding: 11, gap: 3 },
  progressMetricCompactTitle: { color: colors.ink2, fontSize: 11, fontWeight: "800" },
  progressMetricCompactValue: { color: colors.ink, fontSize: 15, fontWeight: "900" },
  planPage: { flex: 1, backgroundColor: colors.paper },
  planFixedHeader: { paddingHorizontal: 18, paddingTop: 13, paddingBottom: 10, gap: 13, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  planTitleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  compactTextButton: { minHeight: 36, borderRadius: radius.chip, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white, justifyContent: "center", paddingHorizontal: 14 },
  compactTextButtonText: { color: colors.ink, fontSize: 12, fontWeight: "800" },
  planTabs: { flexDirection: "row", gap: 4, padding: 4, borderRadius: 16, backgroundColor: colors.paper2 },
  planTab: { flex: 1, minHeight: 48, borderRadius: 13, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14 },
  planTabActive: { backgroundColor: colors.dark },
  planTabText: { color: colors.ink2, fontSize: 14, fontWeight: "800" },
  planTabTextActive: { color: colors.white },
  planTabMeta: { color: colors.ink3, fontSize: 9, fontWeight: "800" },
  planTabMetaActive: { color: colors.lime },
  planTabContent: { paddingHorizontal: 18, paddingTop: 14, paddingBottom: 168, gap: 13 },
  calendarIntakeRow: { minHeight: 64, marginTop: 12, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  calendarIntakeLabel: { color: colors.ink3, fontSize: 9, fontWeight: "800" },
  calendarIntakeValue: { color: colors.ink, fontSize: 16, fontWeight: "900", fontFamily: "monospace", marginTop: 4 },
  intakeEyebrow: { color: colors.ink3 },
  nutritionCardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  nutritionCardTitle: { color: colors.ink, fontSize: 22, lineHeight: 27, fontWeight: "900", letterSpacing: -0.4 },
  intakeStatusChip: { minHeight: 28, borderRadius: radius.chip, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 6 },
  intakeStatusDot: { width: 7, height: 7, borderRadius: 4 },
  intakeStatusChipText: { fontSize: 10, fontWeight: "900" },
  intakeOverviewRow: { flexDirection: "row", alignItems: "center", gap: 15 },
  intakeOverviewCopy: { flex: 1, minWidth: 0 },
  intakeDayLabel: { color: colors.ink2, fontSize: 11, fontWeight: "800" },
  intakeTargetValue: { color: colors.ink, fontSize: 29, lineHeight: 34, fontWeight: "900", letterSpacing: -1, marginTop: 4 },
  intakeTargetUnit: { color: colors.ink3, fontSize: 10, fontWeight: "800", marginTop: -2 },
  intakeTargetRange: { color: colors.ink2, fontSize: 10, lineHeight: 15, marginTop: 7 },
  intakeAdjustmentSummary: { color: colors.ink3, fontSize: 9, lineHeight: 14, marginTop: 4 },
  intakeRingWrap: { position: "relative", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  intakeRingCenter: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center" },
  intakeRingValue: { fontSize: 20, lineHeight: 24, fontWeight: "900", letterSpacing: -0.6 },
  intakeRingUnit: { color: colors.ink3, fontSize: 8, fontWeight: "800", marginTop: 1 },
  intakeRingPercent: { fontSize: 10, fontWeight: "900", marginTop: 4 },
  intakeExplanation: { borderLeftWidth: 3, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, gap: 3 },
  intakeExplanationTitle: { fontSize: 12, fontWeight: "900" },
  intakeExplanationBody: { color: colors.ink2, fontSize: 10, lineHeight: 16 },
  nutritionMacroStrip: { minHeight: 68, flexDirection: "row", backgroundColor: colors.paper, borderRadius: 14, paddingHorizontal: 5, paddingVertical: 8 },
  nutritionMacroItem: { flex: 1, justifyContent: "center", paddingHorizontal: 7, gap: 3, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: colors.line },
  nutritionMacroValue: { color: colors.ink, fontSize: 14, fontWeight: "900", fontFamily: "monospace" },
  intakePlanHero: { backgroundColor: colors.white, borderRadius: 26, padding: 18, gap: 14, borderWidth: 1, borderColor: "rgba(22,24,29,0.06)" },
  intakePlanHeroTop: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10 },
  intakePlanHeroTitle: { color: colors.ink, fontSize: 23, fontWeight: "900", letterSpacing: -0.5, marginTop: 5 },
  intakePlanHeroMain: { flexDirection: "row", alignItems: "center", gap: 16 },
  intakePlanHeroNumbers: { flex: 1 },
  intakePlanTarget: { color: colors.ink, fontSize: 34, lineHeight: 39, fontWeight: "900", letterSpacing: -1.2, marginTop: 3 },
  intakePlanPrimary: { minHeight: 50, borderRadius: radius.chip, backgroundColor: colors.dark, paddingLeft: 18, paddingRight: 7, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  intakePlanPrimaryText: { color: colors.white, fontSize: 14, fontWeight: "900" },
  intakePlanPrimaryArrow: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.lime, alignItems: "center", justifyContent: "center" },
  intakePlanPrimaryArrowText: { color: colors.limeInk, fontSize: 20, lineHeight: 22, fontWeight: "700" },
  intakeWeekCard: { backgroundColor: colors.white, borderRadius: 22, paddingVertical: 5, overflow: "hidden" },
  intakeWeekRow: { minHeight: 78, flexDirection: "row", alignItems: "stretch", paddingHorizontal: 10, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  intakeWeekRowCurrent: { backgroundColor: "#F2F3EC" },
  intakeWeekDay: { width: 54, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  intakeWeekDayCurrent: { backgroundColor: colors.dark },
  intakeWeekDayName: { color: colors.ink2, fontSize: 11, fontWeight: "900" },
  intakeWeekDayNameCurrent: { color: colors.white },
  intakeWeekDate: { color: colors.ink3, fontSize: 9, marginTop: 3 },
  intakeWeekDateCurrent: { color: colors.lime },
  intakeWeekBody: { flex: 1, justifyContent: "center", paddingLeft: 12, gap: 5 },
  intakeWeekTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  intakeWeekKind: { color: colors.ink2, fontSize: 11, fontWeight: "800" },
  intakeWeekTarget: { color: colors.ink, fontSize: 12, fontFamily: "monospace", fontWeight: "900" },
  intakeWeekProgress: { height: 4, borderRadius: 2, backgroundColor: colors.paper2, overflow: "hidden", flexDirection: "row" },
  intakeWeekProgressFill: { height: 4, borderRadius: 2 },
  intakeWeekBottom: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  intakeWeekConsumed: { color: colors.ink3, fontSize: 9 },
  intakeWeekStatus: { fontSize: 9, fontWeight: "900" },
  intakeBreakdownCard: { backgroundColor: colors.white, borderRadius: 22, paddingHorizontal: 16, paddingTop: 3, paddingBottom: 12 },
  intakeBreakdownRow: { minHeight: 66, flexDirection: "row", alignItems: "center", gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  intakeBreakdownBody: { flex: 1 },
  intakeBreakdownLabel: { color: colors.ink, fontSize: 12, fontWeight: "900" },
  intakeBreakdownDetail: { color: colors.ink3, fontSize: 9, lineHeight: 14, marginTop: 3 },
  intakeBreakdownValue: { color: colors.ink2, fontSize: 12, fontFamily: "monospace", fontWeight: "900", textAlign: "right" },
  intakeBreakdownValuePositive: { color: colors.fuelSafe },
  intakeBreakdownTotal: { minHeight: 54, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: 8 },
  intakeBreakdownTotalLabel: { color: colors.ink, fontSize: 13, fontWeight: "900" },
  intakeBreakdownTotalValue: { color: colors.ink, fontSize: 17, fontWeight: "900", fontFamily: "monospace" },
  nutritionPrincipleCard: { backgroundColor: colors.dark, borderRadius: 24, padding: 18, gap: 12 },
  nutritionPrincipleLead: { paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: "#343830" },
  nutritionPrincipleValue: { color: colors.lime, fontSize: 24, fontWeight: "900", letterSpacing: -0.5 },
  nutritionPrincipleLabel: { color: "#9FA59B", fontSize: 10, fontWeight: "800", marginTop: 4 },
  progressContent: { paddingHorizontal: 18, paddingTop: 14, paddingBottom: 168, gap: 14 },
  progressHero: { backgroundColor: colors.dark, borderRadius: 28, padding: 21, gap: 18 },
  progressHeroTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  progressHeroKicker: { color: colors.lime, fontSize: 9, fontWeight: "900", letterSpacing: 1.5 },
  progressHeroPeriod: { color: "#8F958B", fontSize: 10, fontWeight: "800" },
  progressHeroMain: { flexDirection: "row", alignItems: "flex-end", gap: 13 },
  progressHeroValue: { color: colors.white, fontSize: 68, lineHeight: 70, fontWeight: "900", letterSpacing: -3 },
  progressHeroUnit: { paddingBottom: 9 },
  progressHeroUnitStrong: { color: colors.white, fontSize: 15, fontWeight: "900" },
  progressHeroUnitSub: { color: "#8F958B", fontSize: 9, marginTop: 4 },
  progressHeroFooter: { flexDirection: "row", gap: 10, paddingTop: 14, borderTopWidth: 1, borderTopColor: "#343830" },
  progressHeroFooterLabel: { color: "#8F958B", fontSize: 9, fontWeight: "800" },
  progressHeroFooterValue: { color: colors.white, fontSize: 13, fontWeight: "900", marginTop: 4, minWidth: 112 },
  editorialSectionHeader: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginTop: 6 },
  editorialSectionTitle: { color: colors.ink, fontSize: 18, fontWeight: "900", letterSpacing: -0.25 },
  editorialSectionMeta: { color: colors.ink3, fontSize: 10, fontWeight: "700" },
  bodySnapshotCard: { backgroundColor: colors.white, borderRadius: 20, paddingHorizontal: 16 },
  bodyTrendRow: { minHeight: 70, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  bodyTrendLabel: { color: colors.ink, fontSize: 13, fontWeight: "900" },
  bodyTrendMeta: { color: colors.ink3, fontSize: 9, marginTop: 4 },
  bodyTrendValue: { color: colors.ink, fontSize: 23, fontWeight: "900", fontFamily: "monospace", letterSpacing: -0.5 },
  metricDecisionCard: { backgroundColor: colors.white, borderRadius: 22, paddingHorizontal: 14 },
  metricDecisionRow: { minHeight: 84, flexDirection: "row", alignItems: "center", gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  metricDecisionIndex: { width: 24, color: colors.ink3, fontSize: 10, fontFamily: "monospace", fontWeight: "800" },
  metricDecisionBody: { flex: 1, gap: 5 },
  metricDecisionTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  metricDecisionTitle: { color: colors.ink, fontSize: 12, fontWeight: "900" },
  metricDecisionValue: { fontSize: 10, fontWeight: "900" },
  metricDecisionRail: { height: 3, borderRadius: 2, backgroundColor: colors.paper2, overflow: "hidden", flexDirection: "row" },
  metricDecisionFill: { height: 3, borderRadius: 2 },
  metricDecisionMeta: { color: colors.ink3, fontSize: 9 },
  profileHero: { backgroundColor: colors.dark, borderRadius: 28, padding: 21, gap: 5 },
  profileHeroTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
  profileHeroKicker: { color: colors.lime, fontSize: 9, fontWeight: "900", letterSpacing: 1.5 },
  profileHeroStatus: { color: "#A7ACA2", fontSize: 10, fontWeight: "800" },
  profileHeroLabel: { color: "#8F958B", fontSize: 10, fontWeight: "800" },
  profileHeroTitle: { color: colors.white, fontSize: 34, lineHeight: 39, fontWeight: "900", letterSpacing: -1 },
  profileHeroMeta: { color: "#B7BBB3", fontSize: 12, marginTop: 3 },
  profileHeroStats: { flexDirection: "row", gap: 9, marginTop: 17 },
  profileHeroStat: { flex: 1, minHeight: 68, borderRadius: 15, backgroundColor: "#1B1E19", justifyContent: "center", paddingHorizontal: 13 },
  profileHeroStatValue: { color: colors.white, fontSize: 20, fontWeight: "900", fontFamily: "monospace" },
  profileHeroStatLabel: { color: "#8F958B", fontSize: 9, marginTop: 3 },
  page: { flex: 1, backgroundColor: colors.paper },
  cloudCanonicalStatus: { backgroundColor: colors.dark, paddingHorizontal: 18, paddingVertical: 8, gap: 2 },
  cloudCanonicalHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  cloudCanonicalTitle: { color: colors.lime, fontSize: 11, fontWeight: "900", flex: 1 },
  cloudCanonicalMeta: { color: "#B7BBB3", fontSize: 10 },
  cloudCanonicalRetry: { color: colors.white, fontSize: 10, fontWeight: "900" },
  cloudCanonicalError: { color: "#F4B8AE", fontSize: 10 },
  content: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 168, gap: 14 },
  onboardingContent: { paddingHorizontal: 18, paddingTop: 12, paddingBottom: 72, gap: 12 },
  onboardingHero: { backgroundColor: colors.dark, borderRadius: 28, padding: 22, paddingBottom: 20, minHeight: 276, justifyContent: "space-between", overflow: "hidden" },
  onboardingHeroTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  onboardingKicker: { color: colors.lime, fontSize: 10, fontWeight: "900", letterSpacing: 1.7 },
  onboardingStep: { color: "#858B80", fontSize: 11, fontFamily: "monospace", fontWeight: "800" },
  onboardingHeroTitle: { color: colors.white, fontSize: 35, lineHeight: 40, fontWeight: "900", letterSpacing: -1.2, marginTop: 28 },
  onboardingHeroCopy: { color: "#B6BBB1", fontSize: 13, lineHeight: 20, maxWidth: 310, marginTop: 14 },
  onboardingProgress: { flexDirection: "row", gap: 6, marginTop: 22 },
  onboardingProgressOn: { height: 3, flex: 1, borderRadius: 2, backgroundColor: colors.lime },
  onboardingProgressOff: { height: 3, flex: 1, borderRadius: 2, backgroundColor: "#353A33" },
  quickChoiceCard: { backgroundColor: colors.white, borderRadius: 22, padding: 17, gap: 13, borderWidth: 1, borderColor: "rgba(22,24,29,0.055)" },
  quickChoiceHeading: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  quickChoiceStep: { width: 28, color: colors.limeInk, fontSize: 11, fontFamily: "monospace", fontWeight: "900", paddingTop: 3 },
  quickChoiceHeadingBody: { flex: 1 },
  quickChoiceTitle: { color: colors.ink, fontSize: 17, fontWeight: "900", letterSpacing: -0.25 },
  quickChoiceHint: { color: colors.ink3, fontSize: 11, lineHeight: 16, marginTop: 4 },
  quickChoiceOption: { flexGrow: 1, alignItems: "center", backgroundColor: colors.paper },
  quickChoiceMicro: { color: colors.ink2, fontSize: 11, fontWeight: "900", marginTop: 2 },
  rhythmOption: { minWidth: 62, flexGrow: 1, alignItems: "center", backgroundColor: colors.paper },
  additionalProfileEntry: { minHeight: 82, borderRadius: 22, paddingHorizontal: 15, paddingVertical: 13, backgroundColor: "#E8E7E0", flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderColor: "transparent" },
  additionalProfileEntryOpen: { borderColor: colors.limeDeep, backgroundColor: "#F0F7D9" },
  additionalProfileMark: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.dark, alignItems: "center", justifyContent: "center" },
  additionalProfileMarkText: { color: colors.lime, fontSize: 22, lineHeight: 24, fontWeight: "500" },
  additionalProfileBody: { flex: 1 },
  additionalProfileTitle: { color: colors.ink, fontSize: 15, fontWeight: "900" },
  additionalProfileMeta: { color: colors.ink3, fontSize: 11, lineHeight: 16, marginTop: 4 },
  additionalProfileArrow: { color: colors.limeInk, fontSize: 11, fontWeight: "900" },
  additionalProfilePanel: { backgroundColor: colors.white, borderRadius: 24, padding: 18, gap: 13, borderLeftWidth: 3, borderLeftColor: colors.limeDeep },
  additionalPanelEyebrow: { color: colors.limeInk, fontSize: 9, fontWeight: "900", letterSpacing: 1.4 },
  additionalPanelTitle: { color: colors.ink, fontSize: 21, fontWeight: "900", marginTop: 5 },
  additionalPanelCopy: { color: colors.ink3, fontSize: 12, lineHeight: 18, marginTop: 5 },
  additionalGroupTitle: { color: colors.ink2, fontSize: 12, fontWeight: "900", marginTop: 5 },
  additionalFieldNote: { color: colors.ink3, fontSize: 10, lineHeight: 15, marginTop: -4 },
  safetyConfirmCard: { backgroundColor: "#F0F7D9", borderRadius: 22, padding: 8, gap: 4 },
  safetyConfirmEyebrow: { color: colors.limeInk, fontSize: 10, fontWeight: "900", letterSpacing: 1.2, paddingHorizontal: 8, paddingTop: 7, paddingBottom: 2 },
  onboardingButtonArrow: { color: colors.lime, fontSize: 22, fontWeight: "500" },
  onboardingPrivacyNote: { color: colors.ink3, fontSize: 10, textAlign: "center", lineHeight: 15, marginBottom: 12 },
  reportContent: { paddingHorizontal: 18, paddingTop: 12, paddingBottom: 72, gap: 13 },
  reportCover: { backgroundColor: colors.dark, borderRadius: 28, padding: 22, gap: 10, overflow: "hidden" },
  committedPlanHero: { backgroundColor: colors.dark, borderRadius: 28, padding: 22, gap: 10, overflow: "hidden" },
  reportCoverTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  reportKicker: { color: colors.lime, fontSize: 9, fontWeight: "900", letterSpacing: 1.5 },
  reportStatus: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#272B25", borderRadius: radius.chip, paddingHorizontal: 9, paddingVertical: 6 },
  reportStatusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.lime },
  reportStatusText: { color: "#C9CEC4", fontSize: 10, fontWeight: "800" },
  reportCoverLabel: { color: "#92978F", fontSize: 11, fontWeight: "800" },
  reportCoverTitle: { color: colors.white, fontSize: 36, lineHeight: 40, fontWeight: "900", letterSpacing: -1.3 },
  reportCoverCopy: { color: "#B8BDB4", fontSize: 12, lineHeight: 19, marginTop: 1 },
  reportMetricGrid: { flexDirection: "row", gap: 7, marginTop: 13 },
  reportMetric: { flex: 1, minHeight: 69, borderRadius: 14, backgroundColor: "#1C201A", padding: 10, justifyContent: "space-between" },
  reportMetricValue: { color: colors.white, fontSize: 15, fontWeight: "900" },
  reportMetricLabel: { color: "#848A80", fontSize: 9, fontWeight: "700" },
  reportConfidenceRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", marginTop: 5 },
  reportConfidence: { color: colors.lime, fontSize: 10, fontWeight: "900" },
  reportConfidenceMeta: { color: "#858B80", fontSize: 10 },
  reportSectionHeading: { flexDirection: "row", alignItems: "flex-start", gap: 12, marginTop: 16, marginBottom: 1 },
  reportSectionIndex: { color: colors.limeInk, fontFamily: "monospace", fontSize: 12, fontWeight: "900", width: 28, paddingTop: 4 },
  reportSectionHeadingBody: { flex: 1 },
  reportSectionTitle: { color: colors.ink, fontSize: 23, fontWeight: "900", letterSpacing: -0.55 },
  reportSectionSubtitle: { color: colors.ink3, fontSize: 11, lineHeight: 16, marginTop: 4 },
  weekStrip: { flexDirection: "row", gap: 4, backgroundColor: colors.white, padding: 8, borderRadius: 18 },
  weekStripDay: { flex: 1, minHeight: 57, borderRadius: 12, alignItems: "center", justifyContent: "center", gap: 4 },
  weekStripDayOn: { backgroundColor: colors.dark },
  weekStripLabel: { color: colors.ink3, fontSize: 9, fontWeight: "800" },
  weekStripLabelOn: { color: "#AEB4AA" },
  weekStripDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: colors.paper2 },
  weekStripDotOn: { backgroundColor: colors.lime },
  weekStripDate: { color: colors.ink2, fontSize: 13, fontFamily: "monospace", fontWeight: "900" },
  weekStripDateOn: { color: colors.white },
  reportSessionCard: { backgroundColor: colors.white, borderRadius: 22, padding: 17, gap: 12 },
  reportSessionTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  reportSessionDate: { color: colors.limeInk, fontSize: 10, fontWeight: "900" },
  reportSessionTitle: { color: colors.ink, fontSize: 18, fontWeight: "900", marginTop: 5 },
  reportSessionOrdinal: { color: "#E3E3DB", fontSize: 30, lineHeight: 32, fontFamily: "monospace", fontWeight: "900" },
  reportTaskList: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  reportTaskRow: { minHeight: 42, flexDirection: "row", alignItems: "center", gap: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  reportTaskBullet: { width: 7, height: 7, borderRadius: 2, backgroundColor: colors.limeDeep },
  reportTaskName: { flex: 1, color: colors.ink, fontSize: 12, fontWeight: "800" },
  reportTaskDose: { color: colors.ink2, fontSize: 10, fontFamily: "monospace", fontWeight: "700" },
  reportAerobicBlock: { gap: 4, padding: 11, borderRadius: 13, backgroundColor: "#EEF9C7" },
  reportAerobicTitle: { color: colors.limeInk, fontSize: 11, fontWeight: "900" },
  reportAerobicCopy: { color: colors.ink2, fontSize: 10, lineHeight: 15, fontWeight: "700" },
  reportAerobicGuard: { color: colors.terra, fontSize: 10, lineHeight: 15, fontWeight: "800" },
  reportSessionFoot: { color: colors.ink3, fontSize: 10, lineHeight: 15 },
  committedSessionSets: { color: colors.limeInk, backgroundColor: colors.lime, borderRadius: radius.chip, paddingHorizontal: 9, paddingVertical: 6, fontSize: 10, fontWeight: "900" },
  committedRestDay: { backgroundColor: "#EAE9E3", borderRadius: 17, paddingHorizontal: 14, paddingVertical: 12, flexDirection: "row", alignItems: "center", gap: 9 },
  committedRestDate: { color: colors.ink3, width: 88, fontSize: 10, fontWeight: "800" },
  committedRestTitle: { color: colors.ink, fontSize: 12, fontWeight: "900" },
  committedRestMeta: { flex: 1, color: colors.ink3, fontSize: 9, lineHeight: 14, textAlign: "right" },
  reportRuleCard: { backgroundColor: "#EEF9C7", borderRadius: 20, padding: 16, gap: 10 },
  reportRuleEyebrow: { color: colors.limeInk, fontSize: 10, letterSpacing: 1, fontWeight: "900", marginBottom: 2 },
  reportBulletRow: { flexDirection: "row", alignItems: "flex-start", gap: 9 },
  reportBullet: { width: 7, height: 7, borderRadius: 2, backgroundColor: colors.limeDeep, marginTop: 6 },
  reportBulletGuard: { backgroundColor: colors.terra },
  reportBulletUnknown: { backgroundColor: colors.ink3 },
  reportBulletText: { flex: 1, color: colors.ink2, fontSize: 12, lineHeight: 18 },
  nutritionReportCard: { backgroundColor: colors.dark, borderRadius: 24, padding: 18, gap: 16 },
  nutritionReportMetrics: { flexDirection: "row", alignItems: "stretch" },
  nutritionReportMetric: { flex: 1, gap: 5 },
  nutritionReportDivider: { width: 1, backgroundColor: "#343830", marginHorizontal: 14 },
  nutritionReportValue: { color: colors.lime, fontSize: 21, fontWeight: "900", letterSpacing: -0.4 },
  nutritionReportLabel: { color: "#979D93", fontSize: 10, fontWeight: "800" },
  reportCalibration: { borderRadius: 14, backgroundColor: "#242821", padding: 13, gap: 5 },
  reportCalibrationTitle: { color: colors.white, fontSize: 12, fontWeight: "900" },
  reportCalibrationCopy: { color: "#A8AEA3", fontSize: 10, lineHeight: 16 },
  intakeSteps: { gap: 0 },
  intakeStep: { flexDirection: "row", alignItems: "flex-start", gap: 11, paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#343830" },
  intakeStepIndex: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.lime, color: colors.limeInk, textAlign: "center", paddingTop: 4, fontSize: 10, fontWeight: "900" },
  intakeStepBody: { flex: 1 },
  intakeStepTitle: { color: colors.white, fontSize: 12, fontWeight: "900" },
  intakeStepDetail: { color: "#9FA59B", fontSize: 10, lineHeight: 16, marginTop: 4 },
  strategyStack: { gap: 8 },
  strategyReportCard: { backgroundColor: colors.white, borderRadius: 18, padding: 14, flexDirection: "row", alignItems: "flex-start", gap: 12 },
  strategyReportMark: { width: 32, height: 32, borderRadius: 10, backgroundColor: colors.dark, alignItems: "center", justifyContent: "center" },
  strategyReportMarkText: { color: colors.lime, fontSize: 12, fontWeight: "900" },
  strategyReportBody: { flex: 1 },
  strategyReportTitle: { color: colors.ink, fontSize: 13, fontWeight: "900" },
  strategyReportCopy: { color: colors.ink2, fontSize: 11, lineHeight: 17, marginTop: 4 },
  reportEvidenceCard: { backgroundColor: colors.white, borderRadius: 20, padding: 16, gap: 9 },
  forecastStack: { gap: 8 },
  forecastReportCard: { backgroundColor: colors.white, borderRadius: 20, padding: 16, gap: 7, borderWidth: 1, borderColor: "transparent" },
  forecastReportCardRecommended: { borderColor: colors.limeDeep, backgroundColor: "#F5FAE5" },
  forecastReportTop: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  forecastReportTitle: { color: colors.ink, fontSize: 16, fontWeight: "900" },
  forecastReportEligibility: { color: colors.ink3, fontSize: 10, marginTop: 3 },
  forecastRecommended: { color: colors.limeInk, backgroundColor: colors.lime, paddingHorizontal: 9, paddingVertical: 5, borderRadius: radius.chip, fontSize: 9, fontWeight: "900" },
  forecastReportDate: { color: colors.ink, fontSize: 12, fontFamily: "monospace", fontWeight: "900", marginTop: 3 },
  forecastReportMeta: { color: colors.ink2, fontSize: 10, lineHeight: 16 },
  forecastReportConfidence: { color: colors.limeInk, fontSize: 9, fontWeight: "800", marginTop: 2 },
  reportUnknownCard: { backgroundColor: colors.white, borderRadius: 20, padding: 16, gap: 10 },
  reportCitation: { backgroundColor: colors.paper, borderRadius: 13, padding: 12, gap: 4, marginTop: 3 },
  reportCitationTitle: { color: colors.ink, fontSize: 10, fontWeight: "900" },
  reportCitationCopy: { color: colors.ink2, fontSize: 10, lineHeight: 16 },
  reportBoundary: { color: colors.ink3, fontSize: 9, lineHeight: 15, marginTop: 3 },
  reportConfirmButton: { minHeight: 56, borderRadius: radius.chip, backgroundColor: colors.dark, paddingHorizontal: 20, flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 10 },
  reportConfirmText: { color: colors.white, fontSize: 15, fontWeight: "900" },
  reportConfirmArrow: { color: colors.lime, fontSize: 22 },
  reportSecondaryButton: { minHeight: 48, borderRadius: radius.chip, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center", backgroundColor: colors.white },
  reportSecondaryText: { color: colors.ink, fontSize: 13, fontWeight: "800" },
  statePage: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, backgroundColor: colors.paper, padding: 24 },
  stateTitle: { fontSize: 19, fontWeight: "800", color: colors.ink }, stateText: { color: colors.ink2, textAlign: "center", lineHeight: 20 }, retry: { backgroundColor: colors.dark, borderRadius: radius.chip, paddingHorizontal: 22, paddingVertical: 11 }, retryText: { color: colors.white, fontWeight: "800" },
  noticeSpacer: { height: 4 }, coachNotice: { height: 48, borderRadius: 15, backgroundColor: colors.white, flexDirection: "row", alignItems: "center", paddingHorizontal: 14, gap: 10 }, noticeDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.limeDeep }, coachNoticeText: { flex: 1, fontWeight: "700", color: colors.ink }, noticeChevron: { color: colors.ink3, fontSize: 22 },
  todayHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 6 }, date: { fontSize: 17, fontWeight: "800", color: colors.ink }, calendarLink: { color: colors.ink2, fontWeight: "700" },
  dashboardFlipStage: { position: "relative", width: "100%" },
  dashboardFlipFace: { position: "absolute", top: 0, right: 0, left: 0, backfaceVisibility: "hidden" },
  dashboardNutritionCard: {
    minHeight: DASHBOARD_CARD_MIN_HEIGHT,
    borderRadius: 30,
    paddingTop: 24,
    paddingHorizontal: 24,
    paddingBottom: 17,
    justifyContent: "space-between",
  },
  cardFlipButtonDark: { position: "absolute", zIndex: 3, top: 18, right: 20, minWidth: 72, height: 32, paddingHorizontal: 11, borderRadius: 13, borderWidth: 1, borderColor: "rgba(255,255,255,0.14)", backgroundColor: "#252922", alignItems: "center", justifyContent: "center" },
  cardFlipButtonDarkText: { color: colors.lime, fontSize: 11, fontWeight: "900" },
  cardFlipButtonLight: { minWidth: 72, height: 32, paddingHorizontal: 11, borderRadius: 13, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.paper, alignItems: "center", justifyContent: "center" },
  cardFlipButtonLightText: { color: colors.ink, fontSize: 11, fontWeight: "900" },
  intakeActivityCredit: { marginTop: 4, color: colors.limeInk, fontSize: 10, fontWeight: "900" },
  cardFlipButtonPressed: { opacity: 0.72, transform: [{ scale: 0.96 }] },
  todayCard: { minHeight: 456, borderRadius: 30, backgroundColor: colors.dark, overflow: "hidden" }, summaryArea: { padding: 24, paddingBottom: 18 }, cardEyebrow: { color: colors.lime, fontSize: 12, fontWeight: "800", letterSpacing: 1.1 }, planTitle: { color: colors.white, fontSize: 35, lineHeight: 40, fontWeight: "900", marginTop: 10 }, planSubtitle: { color: "#B7BBB3", fontSize: 14, marginTop: 8 }, metricsRow: { flexDirection: "row", gap: 12, marginTop: 18 }, metric: { flex: 1, borderTopColor: "rgba(255,255,255,0.18)", borderTopWidth: 1, paddingTop: 8 }, metricValue: { color: colors.white, fontSize: 19, fontWeight: "800" }, metricLabel: { color: "#999E96", fontSize: 10, marginTop: 3 },
  taskArea: { height: 176, backgroundColor: "rgba(255,255,255,0.05)", borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.10)" }, taskScroll: { paddingVertical: 2 }, taskRow: { minHeight: 48, paddingHorizontal: 24, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 12 }, taskName: { flex: 1, color: colors.white, fontSize: 14, fontWeight: "700" }, taskSummary: { maxWidth: "45%", flexShrink: 1, color: "#B6BAAF", fontFamily: "monospace", fontSize: 11, textAlign: "right" }, rowDivider: { position: "absolute", bottom: 0, left: 24, right: 24, height: StyleSheet.hairlineWidth, backgroundColor: "rgba(255,255,255,0.12)" }, planEmpty: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 30 }, planEmptyText: { color: "#B7BBB3", textAlign: "center", lineHeight: 20 }, cardFooter: { height: 84, paddingHorizontal: 24, justifyContent: "center" }, primaryButton: { backgroundColor: colors.white, minHeight: 50, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", borderRadius: radius.chip, borderWidth: 1, borderColor: colors.line }, todayPrimaryButton: { paddingLeft: 19, paddingRight: 7, justifyContent: "space-between" }, primaryButtonText: { color: colors.ink, fontSize: 16, fontWeight: "900" }, primaryButtonArrow: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.lime, alignItems: "center", justifyContent: "center" }, primaryButtonArrowText: { color: colors.limeInk, fontSize: 19, lineHeight: 21, fontWeight: "900" },
  primaryButtonDisabled: { opacity: 0.42 },
  activityLogButton: { minHeight: 44, borderRadius: radius.chip, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white, alignItems: "center", justifyContent: "center" }, activityLogButtonText: { color: colors.ink, fontSize: 14, fontWeight: "800" },
  startChoiceScrim: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: 40, justifyContent: "flex-end", backgroundColor: "rgba(10,12,10,0.42)" }, startChoiceSheet: { backgroundColor: colors.paper, borderTopLeftRadius: 30, borderTopRightRadius: 30, paddingHorizontal: 22, paddingTop: 12, paddingBottom: 38, gap: 12 }, sheetHandle: { width: 38, height: 4, borderRadius: 4, backgroundColor: colors.line, alignSelf: "center", marginBottom: 4 }, startChoiceTitle: { color: colors.ink, fontSize: 25, lineHeight: 30, fontWeight: "900" }, startChoiceSub: { color: colors.ink2, fontSize: 13, lineHeight: 19, marginBottom: 3 }, startChoicePrimary: { backgroundColor: colors.dark, borderRadius: radius.card, minHeight: 78, justifyContent: "center", paddingHorizontal: 17 }, startChoicePrimaryTitle: { color: colors.white, fontSize: 16, fontWeight: "900" }, startChoicePrimarySub: { color: "#B7BBB3", fontSize: 12, marginTop: 4 }, startChoiceSecondary: { backgroundColor: colors.white, borderRadius: radius.card, minHeight: 78, justifyContent: "center", paddingHorizontal: 17, borderWidth: 1, borderColor: colors.line }, startChoiceSecondaryTitle: { color: colors.ink, fontSize: 16, fontWeight: "900" }, startChoiceSecondarySub: { color: colors.ink3, fontSize: 12, marginTop: 4 },
  logScrim: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: 42, justifyContent: "flex-end", backgroundColor: "rgba(10,12,10,0.42)" }, logSheet: { backgroundColor: colors.paper, borderTopLeftRadius: 30, borderTopRightRadius: 30, paddingHorizontal: 22, paddingTop: 12, paddingBottom: 38, gap: 12 }, logTitle: { color: colors.ink, fontSize: 24, fontWeight: "900" }, logModeRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, logMode: { flexGrow: 1, minWidth: 56, minHeight: 38, borderRadius: radius.chip, alignItems: "center", justifyContent: "center", backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line }, logModeSelected: { backgroundColor: colors.dark, borderColor: colors.dark }, logModeText: { color: colors.ink2, fontSize: 13, fontWeight: "800" }, logModeTextSelected: { color: colors.lime }, logQuickRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, logQuick: { minHeight: 36, borderRadius: radius.chip, paddingHorizontal: 13, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, justifyContent: "center" }, logQuickSelected: { backgroundColor: "#EEF9C7", borderColor: colors.limeDeep }, logQuickText: { color: colors.ink2, fontSize: 12, fontWeight: "700" }, logQuickTextSelected: { color: colors.limeInk }, logInput: { minHeight: 46, borderRadius: 12, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white, color: colors.ink, paddingHorizontal: 13, fontSize: 14 }, logDuration: { minHeight: 46, borderRadius: 12, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white, paddingHorizontal: 13, flexDirection: "row", alignItems: "center" }, logLabel: { flex: 1, color: colors.ink2, fontSize: 13 }, logDurationInput: { width: 70, color: colors.ink, fontFamily: "monospace", textAlign: "right", fontWeight: "800", fontSize: 15 }, nutritionChoice: { gap: 7 }, nutritionMetricGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, nutritionMetric: { width: "48%", minHeight: 68, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 12, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white, gap: 5 }, nutritionMetricLabel: { color: colors.ink2, fontSize: 12, fontWeight: "700" }, nutritionMetricInput: { color: colors.ink, fontFamily: "monospace", fontWeight: "800", fontSize: 16, padding: 0 }, logSave: { minHeight: 48, borderRadius: radius.chip, backgroundColor: colors.dark, alignItems: "center", justifyContent: "center", marginTop: 2 }, logSaveText: { color: colors.lime, fontSize: 16, fontWeight: "900" },
  outcomeSheet: { backgroundColor: colors.paper, borderTopLeftRadius: 30, borderTopRightRadius: 30, paddingHorizontal: 22, paddingTop: 12, paddingBottom: 38, gap: 12 }, outcomeTitle: { color: colors.ink, fontSize: 26, lineHeight: 32, fontWeight: "900" }, outcomeStatus: { color: colors.limeInk, fontSize: 14, fontWeight: "800" }, outcomeMetricRow: { flexDirection: "row", gap: 8 }, outcomeMetric: { flex: 1, minHeight: 80, borderRadius: radius.row, backgroundColor: colors.white, padding: 12, justifyContent: "space-between" }, outcomeMetricValue: { color: colors.ink, fontSize: 17, fontWeight: "900" }, outcomeMetricLabel: { color: colors.ink3, fontSize: 10, lineHeight: 14 }, outcomeFacts: { backgroundColor: colors.white, borderRadius: radius.row, paddingHorizontal: 14 }, outcomeFactRow: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomColor: colors.line, borderBottomWidth: StyleSheet.hairlineWidth }, outcomeFactLabel: { color: colors.ink2, fontSize: 12 }, outcomeFactValue: { color: colors.ink, fontSize: 12, fontWeight: "800" }, outcomeBoundary: { color: colors.ink3, fontSize: 11, lineHeight: 17 }, outcomeCorrectionButton: { minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.chip, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line }, outcomeCorrectionButtonText: { color: colors.ink, fontSize: 14, fontWeight: "800" },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 12 }, sectionTitle: { fontSize: 17, color: colors.ink, fontWeight: "900", marginTop: 4 }, sectionMeta: { color: colors.ink3, fontSize: 12 }, sectionLink: { color: colors.limeInk, fontSize: 12, fontWeight: "800" }, timeline: { backgroundColor: colors.white, borderRadius: radius.card, paddingVertical: 5 }, timelineCompact: { marginTop: 12 }, timelineRow: { flexDirection: "row", paddingVertical: 11, paddingHorizontal: 14, alignItems: "flex-start" }, timelineTime: { color: colors.ink3, fontFamily: "monospace", fontSize: 11, width: 38, paddingTop: 2 }, timelineDot: { width: 8, height: 8, marginTop: 5, marginRight: 12, backgroundColor: colors.limeDeep, borderRadius: 4 }, timelineBody: { flex: 1 }, timelineTitle: { color: colors.ink, fontSize: 14, fontWeight: "700" }, timelineMeta: { color: colors.ink3, fontSize: 11, marginTop: 3 }, timelineCorrect: { minHeight: 30, justifyContent: "center", paddingHorizontal: 8, marginLeft: 8 }, timelineCorrectText: { color: colors.limeInk, fontSize: 12, fontWeight: "800" }, empty: { backgroundColor: colors.white, borderRadius: radius.card, paddingHorizontal: 20, paddingVertical: 24, marginTop: 4 }, emptyCompact: { paddingVertical: 16 }, emptyText: { color: colors.ink2, lineHeight: 20, fontSize: 13 }, pendingCard: { backgroundColor: colors.terraSoft, borderRadius: radius.card, padding: 16, gap: 5 }, pendingLabel: { color: colors.terra, fontWeight: "800", fontSize: 12 }, pendingText: { color: colors.ink, lineHeight: 20 },
  screenHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }, screenTitle: { color: colors.ink, fontSize: 28, fontWeight: "900" }, screenSub: { color: colors.ink3, marginTop: 4, fontSize: 12 }, calendarHeaderActions: { flexDirection: "row", alignItems: "center", gap: 6 }, calendarStep: { width: 34, height: 34, borderRadius: 17, borderColor: colors.line, borderWidth: 1, alignItems: "center", justifyContent: "center" }, calendarStepText: { color: colors.ink, fontSize: 23, lineHeight: 25 }, modeButton: { borderColor: colors.line, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.chip }, modeButtonText: { color: colors.ink, fontWeight: "800", fontSize: 12 },
  calendarGrid: { flexDirection: "row", flexWrap: "wrap", backgroundColor: colors.white, borderRadius: radius.card, padding: 10 }, calendarGridWeek: { flexWrap: "nowrap" }, calendarCell: { width: "14.285%", minHeight: 54, alignItems: "center", justifyContent: "center", borderRadius: 12 }, calendarCellSelected: { backgroundColor: colors.dark }, calendarDay: { color: colors.ink, fontWeight: "700", fontSize: 13 }, calendarDaySelected: { color: colors.white }, calendarMarks: { flexDirection: "row", gap: 3, height: 7, marginTop: 5 }, markPlanned: { width: 5, height: 5, borderRadius: 3, borderWidth: 1, borderColor: colors.ink2 }, markCompleted: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.limeDeep }, markPartial: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.terra }, markLog: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.ink3 }, detailCard: { backgroundColor: colors.white, borderRadius: radius.card, padding: 18 }, detailTitle: { color: colors.ink, fontSize: 20, fontWeight: "900", marginTop: 5 }, detailMeta: { color: colors.ink2, fontSize: 12, marginTop: 4 }, planForecastRow: { flexDirection: "row", gap: 7, marginTop: 14 }, planForecastItem: { flex: 1, backgroundColor: colors.paper, borderRadius: 10, padding: 9, gap: 3 }, planForecastName: { color: colors.ink, fontSize: 11, fontWeight: "900" }, planForecastMeta: { color: colors.limeInk, fontSize: 11, fontWeight: "800" }, planForecastDate: { color: colors.ink3, fontSize: 9 }, performedWorkoutRow: { minHeight: 58, marginTop: 14, paddingHorizontal: 12, borderRadius: 12, backgroundColor: "#EEF9C7", flexDirection: "row", alignItems: "center", gap: 10 }, performedWorkoutCopy: { flex: 1 }, performedWorkoutTitle: { color: colors.ink, fontSize: 13, fontWeight: "900" }, performedWorkoutMeta: { color: colors.limeInk, fontSize: 11, lineHeight: 16, marginTop: 3 },
  planSession: { backgroundColor: colors.white, borderRadius: radius.row, padding: 14, flexDirection: "row", alignItems: "center", gap: 12 }, planSessionSubdued: { opacity: 0.68 }, planSessionDate: { width: 42, color: colors.ink2, fontSize: 11, lineHeight: 15 }, planSessionBody: { flex: 1 }, planSessionTitle: { color: colors.ink, fontSize: 15, fontWeight: "800" }, planSessionMeta: { color: colors.ink3, fontSize: 11, marginTop: 4 }, chevron: { color: colors.ink3, fontSize: 22 }, planFootnote: { color: colors.ink3, fontSize: 12, lineHeight: 18, marginTop: 4 },
  exerciseManagerScrim: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: 44, justifyContent: "flex-end", backgroundColor: "rgba(10,12,10,0.42)" }, exerciseManagerSheet: { maxHeight: "82%", backgroundColor: colors.paper, borderTopLeftRadius: 30, borderTopRightRadius: 30, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 28 }, exerciseManagerHeader: { flexDirection: "row", alignItems: "flex-start", gap: 12, marginBottom: 16 }, exerciseManagerHeaderCopy: { flex: 1, minWidth: 0, paddingRight: 4 }, exerciseManagerSub: { color: colors.ink3, fontSize: 12, lineHeight: 18, marginTop: 5 }, exerciseClose: { flexShrink: 0, minWidth: 64, minHeight: 38, paddingHorizontal: 14, borderWidth: 1, borderColor: colors.line, borderRadius: radius.chip, alignItems: "center", justifyContent: "center", backgroundColor: colors.white }, exerciseCloseText: { color: colors.ink, fontSize: 12, fontWeight: "800" }, exerciseManagerScroll: { gap: 10, paddingBottom: 8 }, exerciseRow: { backgroundColor: colors.white, borderRadius: radius.row, minHeight: 64, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 8 }, exerciseRowBody: { flex: 1 }, exerciseRowTitle: { color: colors.ink, fontSize: 14, fontWeight: "800" }, exerciseRowMeta: { color: colors.ink3, fontSize: 11, marginTop: 4 }, exerciseInlineButton: { minHeight: 32, justifyContent: "center", paddingHorizontal: 5 }, exerciseInlineText: { color: colors.ink2, fontSize: 12, fontWeight: "800" }, exerciseArchiveText: { color: colors.terra, fontSize: 12, fontWeight: "800" }, exerciseEmpty: { color: colors.ink2, backgroundColor: colors.white, borderRadius: radius.row, padding: 15, fontSize: 13, lineHeight: 20 }, exerciseForm: { marginTop: 8, padding: 14, borderRadius: radius.card, backgroundColor: "#EEF9C7", gap: 10 }, exerciseFormTitle: { color: colors.ink, fontSize: 16, fontWeight: "900" }, exerciseFieldLabel: { color: colors.ink2, fontSize: 12, fontWeight: "800", marginTop: 2 }, exerciseFormActions: { flexDirection: "row", gap: 9 }, exerciseCancel: { minHeight: 48, minWidth: 78, borderRadius: radius.chip, justifyContent: "center", alignItems: "center", backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line }, exerciseCancelText: { color: colors.ink2, fontSize: 14, fontWeight: "800" }, exerciseSave: { flex: 1, marginTop: 0 },
  progressGrid: { flexDirection: "row", gap: 8 }, progressMetric: { flex: 1, backgroundColor: colors.white, borderRadius: radius.row, padding: 13, minHeight: 112 }, progressMetricValue: { color: colors.ink, fontSize: 20, fontWeight: "900" }, progressMetricLabel: { color: colors.ink2, fontSize: 11, marginTop: 8 }, progressMetricMeta: { color: colors.ink3, fontSize: 10, marginTop: 4, lineHeight: 14 }, reportRow: { backgroundColor: colors.white, borderRadius: radius.row, padding: 15, flexDirection: "row", justifyContent: "space-between" }, reportTitle: { color: colors.ink, fontWeight: "800" }, reportMeta: { color: colors.ink3, fontSize: 11 },
  videoLibraryCard: { backgroundColor: colors.dark, borderRadius: radius.row, padding: 16, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, videoLibraryTitle: { color: colors.white, fontSize: 15, fontWeight: "900" }, videoLibraryMeta: { color: "#aeb3a6", fontSize: 11, marginTop: 5 }, videoLibraryArrow: { color: colors.lime, fontSize: 28, lineHeight: 30 },
  profileCard: { backgroundColor: colors.white, borderRadius: radius.card, paddingHorizontal: 16 }, profileSummaryCard: { paddingHorizontal: 18, paddingVertical: 16 }, profileSummaryCopy: { flex: 1, minWidth: 0 }, profileSingleLineCard: { paddingHorizontal: 18, paddingVertical: 17 }, reminderSettingsCard: { paddingHorizontal: 18, paddingTop: 17, paddingBottom: 8 }, reminderSettingsIntro: { paddingHorizontal: 2, paddingBottom: 12, marginBottom: 2 }, profileStart: { backgroundColor: colors.dark, borderRadius: radius.chip, minHeight: 48, alignItems: "center", justifyContent: "center" }, profileStartText: { color: colors.white, fontSize: 15, fontWeight: "800" }, profileRow: { minHeight: 50, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomColor: colors.line, borderBottomWidth: StyleSheet.hairlineWidth }, profileLabel: { color: colors.ink2, fontSize: 14 }, profileValue: { color: colors.ink, fontSize: 14, fontWeight: "700" }, privacySummaryLoading: { minHeight: 74, alignItems: "center", justifyContent: "center" }, privacySummaryFooter: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }, privacySummaryFooterText: { color: colors.ink3, fontSize: 12, flex: 1 }, privacySheet: { maxHeight: "84%", backgroundColor: colors.paper, borderTopLeftRadius: 30, borderTopRightRadius: 30, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 28 }, privacySheetLoading: { minHeight: 160, alignItems: "center", justifyContent: "center" }, privacyDetailList: { gap: 10, paddingBottom: 8 }, privacyDetailBlock: { backgroundColor: colors.white, borderRadius: radius.row, padding: 14, gap: 7 }, privacyDetailHeading: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 12 }, privacyDetailTitle: { color: colors.ink, fontSize: 14, fontWeight: "900" }, privacyDetailSummary: { color: colors.limeInk, fontSize: 12, fontWeight: "800", textAlign: "right" }, privacyDetailText: { color: colors.ink2, fontSize: 12, lineHeight: 18 }, privacyDetailMeta: { color: colors.ink3, fontSize: 11, lineHeight: 17, marginTop: 1 }, privacyManageButton: { minHeight: 46, borderRadius: radius.chip, backgroundColor: colors.dark, alignItems: "center", justifyContent: "center", marginTop: 2 }, privacyManageButtonText: { color: colors.lime, fontSize: 14, fontWeight: "900" }, replicaConflict: { borderLeftWidth: 2, borderLeftColor: colors.limeDeep, backgroundColor: colors.paper, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, gap: 2, marginTop: 1 }, replicaConflictTitle: { color: colors.ink, fontSize: 12, fontWeight: "800" }, replicaSyncButton: { minHeight: 42, borderRadius: radius.chip, backgroundColor: colors.dark, alignItems: "center", justifyContent: "center", marginTop: 3 }, replicaSyncButtonText: { color: colors.lime, fontSize: 13, fontWeight: "900" }, healthConnectionCard: { paddingVertical: 16, gap: 10 }, healthConnectionTop: { flexDirection: "row", alignItems: "center", gap: 12 }, healthConnectionTitle: { color: colors.ink, fontSize: 15, fontWeight: "900" }, healthConnectionMeta: { color: colors.ink3, fontSize: 12, lineHeight: 18, marginTop: 3 }, healthConnectionNote: { color: colors.ink2, fontSize: 12, lineHeight: 18 }, healthImportedList: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line, marginTop: 2 }, healthConnectionActions: { flexDirection: "row", gap: 8, marginTop: 2 }, healthConnectionPrimary: { flex: 1, minHeight: 40, borderRadius: radius.chip, backgroundColor: colors.dark, alignItems: "center", justifyContent: "center", paddingHorizontal: 12 }, healthConnectionPrimaryText: { color: colors.lime, fontSize: 12, fontWeight: "900" }, healthConnectionSecondary: { minHeight: 40, borderRadius: radius.chip, backgroundColor: colors.paper, borderColor: colors.line, borderWidth: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 14 }, healthConnectionSecondaryText: { color: colors.ink, fontSize: 12, fontWeight: "800" }, actionLogCard: { paddingVertical: 4, overflow: "hidden" }, actionLogRow: { flexDirection: "row", alignItems: "center", minHeight: 68, paddingVertical: 10, borderBottomColor: colors.line, borderBottomWidth: StyleSheet.hairlineWidth, gap: 10 }, actionLogRowLast: { borderBottomWidth: 0 }, actionLogBody: { flex: 1 }, actionLogTitle: { color: colors.ink, fontSize: 13, fontWeight: "800" }, actionLogMeta: { color: colors.ink3, fontSize: 11, marginTop: 4 },
  permissionScrim: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: 44, justifyContent: "flex-end", backgroundColor: "rgba(10,12,10,0.42)" }, permissionSheet: { maxHeight: "82%", backgroundColor: colors.paper, borderTopLeftRadius: 30, borderTopRightRadius: 30, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 28 }, permissionList: { gap: 9, paddingBottom: 8 }, permissionRow: { backgroundColor: colors.white, borderRadius: radius.row, paddingHorizontal: 14, paddingVertical: 13, flexDirection: "row", alignItems: "center", gap: 12 }, permissionBody: { flex: 1 }, permissionTitle: { color: colors.ink, fontSize: 14, fontWeight: "800" }, permissionDescription: { color: colors.ink3, fontSize: 11, lineHeight: 16, marginTop: 4 }, permissionSwitch: { width: 45, height: 28, borderRadius: 16, backgroundColor: colors.paper2, padding: 3, justifyContent: "center" }, permissionSwitchOn: { backgroundColor: colors.limeDeep, alignItems: "flex-end" }, permissionKnob: { width: 22, height: 22, borderRadius: 12, backgroundColor: colors.white, shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 2, shadowOffset: { width: 0, height: 1 } }, permissionKnobOn: { backgroundColor: colors.dark }, actionLogScrim: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: 44, justifyContent: "flex-end", backgroundColor: "rgba(10,12,10,0.42)" }, actionLogSheet: { maxHeight: "82%", backgroundColor: colors.paper, borderTopLeftRadius: 30, borderTopRightRadius: 30, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 28 }, actionLogList: { gap: 9, paddingBottom: 8 }, actionLogDetailRow: { backgroundColor: colors.white, borderRadius: radius.row, padding: 14, gap: 4 }, actionLogDetailTop: { flexDirection: "row", justifyContent: "space-between", gap: 12 }, actionLogResult: { color: colors.limeInk, fontSize: 11, fontWeight: "800" }, actionLogDetailMeta: { color: colors.ink3, fontSize: 11, lineHeight: 16 }, actionLogIntent: { color: colors.ink2, fontSize: 12, lineHeight: 18, marginVertical: 2 }, actionLogReversible: { color: colors.limeInk, fontSize: 11, fontWeight: "800", marginTop: 2 },
  nutritionLedgerCard: { backgroundColor: colors.white, borderRadius: 24, padding: 17, gap: 13, borderWidth: 1, borderColor: "rgba(22,24,29,0.055)" }, nutritionCoverage: { color: colors.limeInk, fontSize: 12, fontWeight: "900" }, nutritionProgressGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, nutritionProgressItem: { width: "48%", backgroundColor: colors.paper2, borderRadius: 12, padding: 10, gap: 3 }, nutritionProgressLabel: { color: colors.ink2, fontSize: 10, fontWeight: "800" }, nutritionProgressValue: { color: colors.ink, fontSize: 18, fontFamily: "monospace", fontWeight: "900" }, nutritionProgressMeta: { color: colors.ink3, fontSize: 9, lineHeight: 13 }, nutritionMealList: { backgroundColor: colors.paper, borderRadius: 14, paddingHorizontal: 12 }, nutritionMealRow: { minHeight: 44, justifyContent: "center", borderBottomColor: colors.line, borderBottomWidth: StyleSheet.hairlineWidth }, nutritionMealTitle: { color: colors.ink, fontSize: 12, fontWeight: "800" }, nutritionMealMeta: { color: colors.ink3, fontSize: 10, marginTop: 3 }, nutritionRecordButton: { flex: 1, minHeight: 44, borderRadius: radius.chip, backgroundColor: colors.dark, alignItems: "center", justifyContent: "center" }, nutritionRecordButtonText: { color: colors.white, fontSize: 13, fontWeight: "900" }, recoveryStatusCard: { backgroundColor: colors.white, borderRadius: radius.card, padding: 16, gap: 9 }, recoveryCheckInButton: { minHeight: 40, borderRadius: radius.chip, backgroundColor: colors.paper2, alignItems: "center", justifyContent: "center" }, recoveryCheckInText: { color: colors.ink, fontSize: 12, fontWeight: "900" }, question: { gap: 9 }, questionLabel: { color: colors.ink, fontWeight: "800", fontSize: 15 }, optionList: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, option: { backgroundColor: colors.white, borderRadius: radius.chip, borderWidth: 1, borderColor: "transparent", minHeight: 40, paddingHorizontal: 13, justifyContent: "center" }, optionSelected: { backgroundColor: "#EEF9C7", borderColor: colors.limeDeep }, optionText: { color: colors.ink2, fontSize: 13, fontWeight: "700" }, optionTextSelected: { color: colors.limeInk }, onboardingFields: { flexDirection: "row", gap: 8 }, onboardingInput: { flex: 1, minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white, color: colors.ink, paddingHorizontal: 10, fontSize: 13 }, professionalToggle: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, professionalToggleText: { color: colors.limeInk, fontSize: 13, fontWeight: "900" }, professionalFields: { backgroundColor: colors.paper2, borderRadius: radius.card, padding: 14, gap: 12 }, confirmRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, backgroundColor: colors.white, borderRadius: radius.row, padding: 14 }, checkbox: { width: 20, height: 20, borderRadius: 6, borderWidth: 1.5, borderColor: colors.ink3, alignItems: "center", justifyContent: "center", marginTop: 1 }, checkboxOn: { borderColor: colors.limeDeep, backgroundColor: colors.lime }, checkboxMark: { color: colors.limeInk, fontWeight: "900" }, confirmText: { flex: 1, color: colors.ink2, fontSize: 13, lineHeight: 19 }, formError: { color: colors.terra, fontSize: 12 }, onboardingButton: { backgroundColor: colors.dark, minHeight: 54, borderRadius: radius.chip, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, marginTop: 4 }, onboardingButtonText: { color: colors.white, fontSize: 16, fontWeight: "900" }, previewRejectButton: { minHeight: 44, alignItems: "center", justifyContent: "center", marginBottom: 24 }, previewRejectText: { color: colors.ink3, fontSize: 13, fontWeight: "800" },
  workoutTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }, workoutTopActions: { alignItems: "flex-end", gap: 8 }, workoutProgress: { color: colors.limeInk, backgroundColor: colors.lime, borderRadius: radius.chip, paddingHorizontal: 11, paddingVertical: 7, fontWeight: "900" }, workoutCoachButton: { minHeight: 34, minWidth: 72, borderRadius: radius.chip, backgroundColor: colors.dark, alignItems: "center", justifyContent: "center", paddingHorizontal: 12 }, workoutCoachButtonText: { color: colors.lime, fontSize: 12, fontWeight: "900" }, currentSetCard: { backgroundColor: colors.dark, borderRadius: 26, padding: 22, gap: 10 }, currentSetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }, completedHistoryButton: { minHeight: 44, justifyContent: "center", paddingHorizontal: 4 }, completedHistoryButtonText: { color: colors.lime, fontSize: 12, fontWeight: "900" }, notRecordedText: { color: "#979C93", fontSize: 12, fontWeight: "800" }, currentSetTitle: { color: colors.white, fontSize: 22, fontWeight: "900" }, currentSetDose: { color: "#C5C9C0", fontSize: 15 }, currentSetBoundary: { color: "#979C93", fontSize: 11, lineHeight: 17, marginBottom: 4 }, completedHistory: { borderRadius: 14, backgroundColor: "rgba(255,255,255,0.08)", paddingHorizontal: 12 }, completedHistoryRow: { minHeight: 42, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(255,255,255,0.12)" }, completedHistoryIndex: { color: "#979C93", width: 18, fontFamily: "monospace" }, completedHistoryDose: { color: colors.white, minWidth: 78, fontWeight: "800" }, completedHistoryDelta: { color: "#B6BAAF", flex: 1, fontSize: 11 }, setReviewTitle: { color: colors.white, fontSize: 18, fontWeight: "900" }, setReviewSnapshot: { color: "#B6BAAF", fontSize: 11 }, observationSummary: { backgroundColor: "rgba(198,241,53,0.12)", borderRadius: 12, padding: 12, gap: 3 }, observationSummaryTitle: { color: colors.lime, fontSize: 12, fontWeight: "900" }, observationSummaryText: { color: colors.white, fontSize: 13, fontWeight: "800" }, observationSummaryBoundary: { color: "#B6BAAF", fontSize: 10, lineHeight: 15 }, setActions: { flexDirection: "row", justifyContent: "space-between", gap: 12 }, actualButton: { flex: 1, alignItems: "center", minHeight: 44, justifyContent: "center" }, actualButtonText: { color: colors.lime, fontWeight: "800", fontSize: 13 }, skipSetText: { color: "#F5B6A4", fontWeight: "800", fontSize: 13 }, actualForm: { gap: 8 }, actualField: { minHeight: 44, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.10)", flexDirection: "row", alignItems: "center", paddingHorizontal: 12 }, actualLabel: { color: "#B6BAAF", width: 52, fontSize: 12 }, actualInput: { flex: 1, color: colors.white, fontSize: 15, fontWeight: "700", paddingVertical: 0, textAlign: "right" }, workoutTask: { backgroundColor: colors.white, borderRadius: radius.card, padding: 16, gap: 4 }, workoutTaskSelected: { borderWidth: 2, borderColor: colors.limeDeep }, workoutRouteRow: { flexDirection: "row", alignItems: "center", minHeight: 44 }, workoutRouteMeta: { color: colors.ink3, fontSize: 12 }, workoutTaskTitle: { color: colors.ink, fontWeight: "800", fontSize: 15, marginBottom: 4 }, workoutSetRow: { flexDirection: "row", alignItems: "center", minHeight: 38, gap: 10 }, workoutSetIndex: { width: 20, height: 20, borderRadius: 10, backgroundColor: colors.paper2, color: colors.ink2, fontSize: 11, textAlign: "center", paddingTop: 3 }, workoutSetDose: { flex: 1, color: colors.ink2, fontFamily: "monospace", fontSize: 12 }, workoutSetState: { color: colors.ink3, fontSize: 11 }, workoutSetDone: { color: colors.limeDeep, fontWeight: "800" }, workoutSetSkipped: { color: colors.terra, fontWeight: "800" }, manageWorkoutTasksButton: { minHeight: 44, borderRadius: radius.chip, borderWidth: 1, borderColor: "#3B4039", alignItems: "center", justifyContent: "center", marginTop: 2 }, manageWorkoutTasksText: { color: colors.white, fontSize: 13, fontWeight: "800" }, workoutTaskEditorRow: { backgroundColor: colors.white, borderRadius: radius.row, padding: 12, gap: 8 }, workoutTaskEditorRowSelected: { borderWidth: 1, borderColor: colors.limeDeep }, workoutTaskEditorPrimary: { minHeight: 44 }, workoutTaskEditorActions: { flexDirection: "row", flexWrap: "wrap", gap: 10 }, workoutTaskTiny: { minHeight: 44, justifyContent: "center" }, workoutTaskTinyText: { color: colors.ink2, fontSize: 12, fontWeight: "800" }, workoutTaskPicker: { backgroundColor: "#EEF9C7", borderRadius: radius.card, padding: 14, gap: 9, marginTop: 4 }, workoutCatalogList: { gap: 6 }, workoutCatalogRow: { backgroundColor: colors.white, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 }, workoutCatalogRowSelected: { borderWidth: 1, borderColor: colors.limeDeep }, workoutTaskBoundary: { color: colors.ink2, fontSize: 11, lineHeight: 16 }, workoutTaskAddFields: { flexDirection: "row", gap: 8 }, workoutTaskNumberField: { flex: 1, minHeight: 46, borderRadius: 12, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white, flexDirection: "row", alignItems: "center", paddingHorizontal: 10 }, workoutTaskNumberLabel: { color: colors.ink2, fontSize: 12 }, workoutTaskNumberInput: { flex: 1, color: colors.ink, fontFamily: "monospace", fontWeight: "800", textAlign: "right", fontSize: 14, paddingVertical: 0 }, workoutTaskButtons: { flexDirection: "row", gap: 8 }, workoutTaskSecondary: { flex: 1, minHeight: 46, borderRadius: radius.chip, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center", backgroundColor: colors.white }, workoutTaskSecondaryText: { color: colors.ink, fontSize: 12, fontWeight: "800" }, workoutTaskAddButton: { flex: 1, marginTop: 0 }, pauseButton: { minHeight: 44, borderRadius: radius.chip, alignItems: "center", justifyContent: "center" }, pauseButtonText: { color: colors.ink3, fontSize: 13, fontWeight: "800" }, safetyPauseButton: { minHeight: 44, borderRadius: radius.chip, alignItems: "center", justifyContent: "center", backgroundColor: colors.terraSoft }, safetyPauseButtonText: { color: colors.terra, fontSize: 13, fontWeight: "900" }, safetyPauseScrim: { ...StyleSheet.absoluteFill, zIndex: 55, justifyContent: "flex-end", backgroundColor: "rgba(10,12,10,0.42)" }, safetyPauseSheet: { backgroundColor: colors.paper, borderTopLeftRadius: 30, borderTopRightRadius: 30, paddingHorizontal: 22, paddingTop: 12, paddingBottom: 38, gap: 10 }, safetyPauseTitle: { color: colors.ink, fontSize: 24, fontWeight: "900" }, safetyPauseDetail: { color: colors.ink2, fontSize: 13, lineHeight: 19, marginBottom: 4 }, safetyPauseChoice: { minHeight: 50, paddingHorizontal: 14, borderRadius: radius.row, backgroundColor: colors.white, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, safetyPauseChoiceText: { flex: 1, color: colors.ink, fontSize: 14, fontWeight: "800" }, safetyPauseCancel: { minHeight: 46, borderRadius: radius.chip, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.line }, safetyPauseCancelText: { color: colors.ink2, fontSize: 14, fontWeight: "800" }, skipSetSheet: { backgroundColor: colors.paper, borderTopLeftRadius: 30, borderTopRightRadius: 30, paddingHorizontal: 22, paddingTop: 12, paddingBottom: 38, gap: 10 }, skipSetTitle: { color: colors.ink, fontSize: 24, fontWeight: "900" }, skipSetDetail: { color: colors.ink2, fontSize: 13, lineHeight: 19 }, skipSetInput: { minHeight: 86, borderRadius: radius.row, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white, color: colors.ink, paddingHorizontal: 13, paddingVertical: 11, textAlignVertical: "top", fontSize: 14 }, skipSetConfirm: { minHeight: 48, borderRadius: radius.chip, alignItems: "center", justifyContent: "center", backgroundColor: colors.dark }, skipSetConfirmText: { color: colors.white, fontWeight: "900", fontSize: 15 }, finishButton: { borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white, minHeight: 48, borderRadius: radius.chip, alignItems: "center", justifyContent: "center" }, finishButtonText: { color: colors.ink, fontWeight: "800" }, pausedPage: { flex: 1, padding: 20, justifyContent: "center", backgroundColor: colors.paper }, pausedCard: { backgroundColor: colors.dark, padding: 24, borderRadius: 28, gap: 13 }, pausedTitle: { color: colors.white, fontSize: 30, fontWeight: "900" }, pausedDetail: { color: "#B7BBB3", fontSize: 14, lineHeight: 21, marginBottom: 8 },
  monitorEntry: { minHeight: 62, backgroundColor: colors.white, borderRadius: radius.row, paddingHorizontal: 15, paddingVertical: 10, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, monitorEntryTitle: { color: colors.ink, fontSize: 13, fontWeight: "800" }, monitorEntrySub: { color: colors.ink3, fontSize: 11, marginTop: 3 }, monitorEntryButton: { minWidth: 54, minHeight: 34, borderRadius: radius.chip, alignItems: "center", justifyContent: "center", backgroundColor: colors.dark }, monitorEntryButtonText: { color: colors.lime, fontSize: 12, fontWeight: "900" }, nextSetRecommendation: { backgroundColor: "#EEF9C7", borderRadius: radius.card, minHeight: 84, padding: 14, flexDirection: "row", alignItems: "center", gap: 12 }, nextSetRecommendationBody: { flex: 1, gap: 2 }, nextSetRecommendationTitle: { color: colors.ink, fontSize: 15, fontWeight: "900" }, nextSetRecommendationDetail: { color: colors.ink2, fontSize: 11, lineHeight: 16 }, nextSetRecommendationButton: { minWidth: 58, minHeight: 38, borderRadius: radius.chip, backgroundColor: colors.dark, alignItems: "center", justifyContent: "center", paddingHorizontal: 12 }, nextSetRecommendationButtonText: { color: colors.lime, fontSize: 12, fontWeight: "900" },
  restCard: { backgroundColor: "#EEF9C7", borderRadius: radius.card, minHeight: 72, paddingHorizontal: 16, paddingVertical: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, restTime: { color: colors.ink, fontFamily: "monospace", fontSize: 24, fontWeight: "900", marginTop: 2 }, restActions: { flexDirection: "row", alignItems: "center", gap: 8 }, restAdd: { backgroundColor: colors.dark, borderRadius: radius.chip, minHeight: 38, paddingHorizontal: 12, alignItems: "center", justifyContent: "center" }, restAddText: { color: colors.lime, fontSize: 12, fontWeight: "900" }, restCancel: { backgroundColor: colors.white, borderColor: colors.line, borderWidth: 1, borderRadius: radius.chip, minHeight: 38, paddingHorizontal: 14, alignItems: "center", justifyContent: "center" }, restCancelText: { color: colors.ink, fontSize: 12, fontWeight: "800" },
  inlineError: { position: "absolute", left: 18, right: 18, bottom: 158, backgroundColor: colors.terraSoft, padding: 10, borderRadius: 12 }, inlineErrorText: { color: colors.terra, textAlign: "center", fontSize: 12 },
  productDock: { position: "absolute", left: 10, right: 10, bottom: 8, overflow: "hidden", borderRadius: 24, borderWidth: 1, borderColor: "rgba(22,24,29,0.10)", backgroundColor: "rgba(255,255,255,0.97)", paddingTop: 8, shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 14 },
  productDockNavigationOnly: { paddingTop: 0 },
  coachDockComposer: { minHeight: 58, marginHorizontal: 8, borderRadius: 18, backgroundColor: colors.dark, flexDirection: "row", alignItems: "center", paddingHorizontal: 10, gap: 10 },
  coachDockComposerPressed: { opacity: 0.92 },
  coachDockMark: { width: 36, height: 36, borderRadius: 12, backgroundColor: colors.lime, alignItems: "center", justifyContent: "center" },
  coachDockMarkText: { color: colors.limeInk, fontSize: 18, fontWeight: "900" },
  coachDockCopy: { flex: 1, minWidth: 0 },
  coachDockTitle: { color: colors.white, fontSize: 12, fontWeight: "900" },
  coachDockMeta: { color: "#92988D", fontSize: 9, marginTop: 3 },
  coachDockArrow: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: "#3A3F37", alignItems: "center", justifyContent: "center" },
  coachDockArrowText: { color: colors.lime, fontSize: 17, fontWeight: "900" },
  tabbar: { height: 66, flexDirection: "row", paddingTop: 9, paddingBottom: 6 }, tab: { flex: 1, alignItems: "center", gap: 3 }, tabIcon: { color: colors.ink3, fontSize: 17, fontWeight: "700" }, tabLabel: { color: colors.ink3, fontSize: 9 }, tabOn: { color: colors.ink, fontWeight: "900" },
});
