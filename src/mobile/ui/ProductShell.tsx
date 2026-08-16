import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  Platform,
} from "react-native";
import Svg, { Circle } from "react-native-svg";

import type { LocalProductKernel } from "../../coach";
import type { ConversationItem, PiAgentConversationModule } from "../../agent-conversation";
import type { RecordModule } from "../../records";
import type { DomainProjection, NutritionStrategyData, PlannedExerciseTask } from "../../coach/domain";
import type { CoachSession, EvidenceBriefArtifact } from "../../coach/model";
import { goalPathStateLabel } from "../../coach/goalPathCopy";
import type { CustomExerciseVariantView, MovementPattern } from "../../knowledge";
import { CoachDrawer } from "../../coach/ui";
import {
  coachDrawerAvailableForRoute,
  type CoachDrawerRoute,
  type CalendarPresentationMode,
  type CoachProductProjection,
  type ProductSession,
  type WorkoutOutcomeProductSummary,
} from "../../product";
import type { TimelineReadEvent } from "../../timeline";
import type { DailyHealthLedger } from "../../health";
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
import { TimelineCorrectionSheet } from "./TimelineCorrectionSheet";
import { WorkoutOutcomeCorrectionSheet } from "./WorkoutOutcomeCorrectionSheet";
import { RecordFocus, type RecordFocusInitialMode } from "./RecordFocus";
import { ProductDock } from "./components/ProductDock";
import { Timeline } from "./components/Timeline";
import {
  forecastEligibility,
  forecastName,
  planningPhrase,
  strategyName,
} from "./planningReport";
import type { ProductShellStateStore } from "./ProductShellStateStore";
import { ProfessionalTermText } from "../ui-kit";
import { workoutHorizontalIntent, workoutReorderIntent } from "./workoutGestures";
import { userFacingError } from "../userFacingError";
import { coachingModeLabel } from "./productCopy";
import {
  applyInboundNavigationIntent,
  initialProductShellState,
  resolveMaxPowerDeepLink,
  type ProductDeepLinkRoute,
  type ProductCoachAttachment,
  type ProductShellRecovery,
  type ProductShellState,
} from "./productNavigation";
import { mobileT, setMobileUiLocale } from "../../i18n";


export type ProductRoute = CoachDrawerRoute;
type PrimaryProductRoute = "today" | "calendar" | "plan" | "profile";

export interface ProductShellProps {
  application: LocalProductKernel;
  conversation: PiAgentConversationModule;
  records: RecordModule;
  userId: string;
  /** Any validated notification or OS Linking event uses the same registry. */
  incomingDeepLink?: string;
  /** Local presentation-state port; domain facts remain in LocalProductKernel. */
  productShellStateStore?: ProductShellStateStore;
  /** Resolved before rendering by the native composition root. */
  initialProductShellRecovery?: ProductShellRecovery;
  onOpenAccountSettings?: () => void;
}

type ActivityLogMode = RecordFocusInitialMode;
const DASHBOARD_CARD_MIN_HEIGHT = 456;

/** Shared iOS/Android shell. It owns navigation presentation state only. */
export function ProductShell({ application, conversation, records, userId, incomingDeepLink, productShellStateStore, initialProductShellRecovery, onOpenAccountSettings }: ProductShellProps) {
  const initialShellState = initialProductShellRecovery?.state ?? initialProductShellState(localDate());
  const [route, setRoute] = useState<ProductRoute>(initialShellState.navigation.route);
  const [date, setDate] = useState(initialShellState.navigation.date);
  // A selected day is a factual-history target.  The calendar viewport is a
  // separate browsing concern: moving from August to July must not silently
  // turn 2026-08-19 into a different selected fact, 2026-07-19.
  const [calendarAnchorDate, setCalendarAnchorDate] = useState(initialShellState.navigation.date);
  const [calendarMode, setCalendarMode] = useState<CalendarPresentationMode>(initialShellState.navigation.calendarMode);
  const [workoutId, setWorkoutId] = useState<string | undefined>(initialShellState.navigation.workoutId);
  const [coachExpanded, setCoachExpanded] = useState(initialShellState.navigation.coachExpanded);
  const [coachComposerAnchor, setCoachComposerAnchor] = useState<CoachComposerAnchor>();
  const [coachFocusRequest, setCoachFocusRequest] = useState(0);
  const [showActivityLog, setShowActivityLog] = useState(false);
  const [activityLogInitialMode, setActivityLogInitialMode] = useState<ActivityLogMode>("picker");
  const [timelineCorrection, setTimelineCorrection] = useState<TimelineReadEvent>();
  const [workoutSummary, setWorkoutSummary] = useState<WorkoutOutcomeProductSummary>();
  const [workoutCorrectionId, setWorkoutCorrectionId] = useState<string>();
  const [screen, setScreen] = useState<CoachProductProjection>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [coachSession, setCoachSession] = useState<CoachSession>();
  const [coachWorking, setCoachWorking] = useState(false);
  const [coachItems, setCoachItems] = useState<readonly ConversationItem[]>([]);
  const [coachSessions, setCoachSessions] = useState<readonly CoachSession[]>([]);
  const [coachAttachment, setCoachAttachment] = useState<ProductCoachAttachment | undefined>(initialShellState.coachAttachment);
  const hydrateCoachRef = useRef<(requestedSession?: CoachSession) => Promise<void>>();
  const initialSignalReconciled = useRef(false);
  const initialShellRecoveryHandled = useRef(false);
  const onboardingCoachOpened = useRef(false);
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
    setLoading(true);
    try {
      const projection = await application.readProductProjection({
        userId,
        date,
        timezoneOffsetMinutes: new Date().getTimezoneOffset() * -1,
        calendarMode,
        calendarAnchorDate,
      });
      setMobileUiLocale(projection.profile.locale);
      setScreen(projection);
      setError(undefined);
    } catch (cause) {
      setError(userFacingError(cause, mobileT("mobile.ui.productshell.6133501b1b")));
    } finally {
      setLoading(false);
    }
  }, [application, calendarAnchorDate, calendarMode, date, userId]);

  // Domain modules own fixed GoalPath review and Conversation ingress. The UI
  // only refreshes projections and, when a material signal opened a thread,
  // makes that durable thread available on the next Coach opening.
  const refreshAfterFormalWrite = useCallback(() => {
    void (async () => {
      await refresh();
      const history = await conversation.read({ kind: "history", userId });
      if (history.kind !== "history") return;
      setCoachSessions(history.conversations);
      const newest = history.conversations[0];
      if (!newest || newest.id === coachSession?.id) return;
      const projection = await conversation.read({ kind: "conversation", userId, conversationId: newest.id });
      if (projection.kind !== "conversation" || !projection.items.some((item) =>
        item.card?.kind === "receipt" && item.card.detail?.startsWith("signal:"),
      )) return;
      await hydrateCoachRef.current?.(projection.conversation);
    })().catch((cause) => setError(userFacingError(cause, mobileT("mobile.ui.productshell.be13ed1540"))));
  }, [coachSession, conversation, refresh, userId]);

  // Every formal Record and Workout write reaches the same kernel-owned fixed
  // signal gate. This shell only reads the resulting projection.
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    const intent = resolveMaxPowerDeepLink(incomingDeepLink);
    if (!intent) return;
    // This is intentionally a view-state transition only. In particular, an
    // external Workout URL does not prepare/activate a session or create a
    // Coach session; WorkoutScreen will read the canonical session by id.
    const next = applyInboundNavigationIntent(navigationState.current, intent);
    setRoute(next.route);
    setDate(next.date);
    setCalendarAnchorDate(next.date);
    setCalendarMode(next.calendarMode);
    setWorkoutId(next.workoutId);
    setCoachExpanded(next.coachExpanded);
    setCoachAttachment((current) => current ? { ...current, foreground: "minimized" } : undefined);
  }, [incomingDeepLink]);

  const beginOrResumeWorkout = useCallback(async () => {
    const today = screen?.today;
    if (!today) return;
    try {
      let id = today.activeWorkout?.id;
      if (!id && !today.session && today.state === "record_first") {
        id = `freestyle-${Date.now().toString(36)}`;
        const localWorkoutId = id;
        const knowledgePins = application.getInstalledKnowledgeVersionPins();
        await application.prepareFreestyleWorkoutSession({ userId, workoutId: localWorkoutId, session: { id: `freestyle-session-${date}`, title: "自由训练", scheduledFor: date, knowledgePins, tasks: [] }, mode: "record_only", idempotencyKey: `mobile-workout:${localWorkoutId}:prepare-freestyle` });
        await application.activateWorkoutSession({ userId, workoutId: localWorkoutId, mode: "record_only", idempotencyKey: `mobile-workout:${localWorkoutId}:activate` });
      }
      if (!id) {
        if (!today.session) throw new Error("record_first_freestyle_session_unavailable");
        if (!screen?.source.planId || !screen.source.planRevision) throw new Error(mobileT("mobile.ui.productshell.697bcb4f78"));
        id = `workout-${Date.now().toString(36)}`;
        const localWorkoutId = id;
        await application.prepareWorkoutSession({ userId, workoutId: localWorkoutId, prescriptionRef: { planId: screen.source.planId!, planRevision: screen.source.planRevision!, sessionPrescriptionId: today.session!.id }, mode: "record_only", idempotencyKey: `mobile-workout:${localWorkoutId}:prepare` });
        await application.activateWorkoutSession({ userId, workoutId: localWorkoutId, mode: "record_only", idempotencyKey: `mobile-workout:${localWorkoutId}:activate` });
      }
      setWorkoutId(id);
      setCoachExpanded(false);
      setRoute("workout");
      await refresh();
    } catch (cause) {
      setError(userFacingError(cause, mobileT("mobile.ui.productshell.010826f04f")));
    }
  }, [application, date, refresh, screen, userId]);

  const requestWorkoutStart = useCallback(() => {
    void beginOrResumeWorkout();
  }, [beginOrResumeWorkout]);

  const hydrateCoach = useCallback(async (requestedSession?: CoachSession) => {
    const history = await conversation.read({ kind: "history", userId });
    const sessions = history.kind === "history" ? history.conversations : [];
    setCoachSessions(sessions);
    let session = requestedSession ?? coachSession;
    if (!session) {
      const opened = await conversation.execute({ kind: "new", userId });
      if (opened.kind !== "opened") return;
      session = opened.conversation;
    } else {
      const opened = await conversation.execute({ kind: "open", userId, conversationId: session.id });
      if (opened.kind !== "opened") return;
      session = opened.conversation;
    }
    const projection = await conversation.read({ kind: "conversation", userId, conversationId: session.id });
    if (projection.kind !== "conversation") return;
    setCoachSession(projection.conversation);
    setCoachItems(projection.items);
    setCoachAttachment({ sessionId: projection.conversation.id, foreground: coachExpanded ? "expanded" : "minimized" });
  }, [coachExpanded, coachSession, conversation, userId]);
  hydrateCoachRef.current = hydrateCoach;

  // The first authenticated surface is the conversation, not a dashboard
  // which asks a new user to discover Coach. Once the baseline is confirmed,
  // this effect deliberately never opens the onboarding surface again.
  useEffect(() => {
    if (!shellRestorationReady || !screen || screen.profile.profileReady || onboardingCoachOpened.current) return;
    onboardingCoachOpened.current = true;
    setCoachExpanded(true);
    void hydrateCoach().catch((cause) => setError(userFacingError(cause, mobileT("mobile.ui.productshell.be13ed1540"))));
  }, [hydrateCoach, screen, shellRestorationReady]);

  // Background daily review and foreground manual writes share the same
  // fixed Signal gate.  A material result can recover the most recent
  // conversation (or create one); no material result creates neither Pi work
  // nor a conversation shell.
  useEffect(() => {
    if (initialSignalReconciled.current || !screen) return;
    initialSignalReconciled.current = true;
    let cancelled = false;
    void (async () => {
      const result = await conversation.execute({
        kind: "reconcile",
        userId,
        causationId: "product-shell-initial-signal-check",
      });
      if (result.kind !== "signal_started") return;
      setCoachWorking(true);
      await conversation.whenIdle(result.conversationId);
      if (cancelled) return;
      setCoachWorking(false);
      const opened = await conversation.execute({ kind: "open", userId, conversationId: result.conversationId });
      if (opened.kind === "opened") await hydrateCoachRef.current?.(opened.conversation);
      await refresh();
    })().catch((cause) => {
      if (!cancelled) setError(userFacingError(cause, mobileT("mobile.ui.productshell.be13ed1540")));
    });
    return () => { cancelled = true; };
  }, [conversation, refresh, screen, userId]);

  // A daily fixed review may have run while the app was closed. Once its
  // durable Conversation is available, route the material signal through the
  // same Pi path as a freshly written Record. The module owns global signal
  // deduplication, so this effect never creates a second Agent run.
  useEffect(() => {
    if (!coachSession) return;
    let cancelled = false;
    void (async () => {
      const result = await conversation.execute({
        kind: "reconcile",
        userId,
        conversationId: coachSession.id,
        causationId: `conversation-open:${coachSession.id}`,
      });
      if (result.kind !== "signal_started") return;
      setCoachWorking(true);
      await conversation.whenIdle(coachSession.id);
      if (!cancelled) {
        setCoachWorking(false);
        await hydrateCoach(coachSession);
        await refresh();
      }
    })().catch((cause) => {
      if (!cancelled) setError(userFacingError(cause, mobileT("mobile.ui.productshell.be13ed1540")));
    });
    return () => { cancelled = true; };
  }, [coachSession, conversation, hydrateCoach, refresh, userId]);

  const sendToCoach = useCallback(async (text: string) => {
    try {
      let session = coachSession;
      if (!session) {
        const opened = await conversation.execute({ kind: "new", userId });
        if (opened.kind !== "opened") throw new Error("conversation_open_failed");
        session = opened.conversation;
      }
      setCoachSession(session);
      setCoachAttachment({
        sessionId: session.id,
        foreground: coachExpanded ? "expanded" : "minimized",
      });
      // The current page rides along as an optional per-turn attachment; it
      // never selects or changes the conversation.
      const attachment = { kind: route, ref: route === "workout" && workoutId ? workoutId : date } as const;
      const sent = await conversation.execute({ kind: "send", userId, conversationId: session.id, text, clientTurnId: `mobile:${Date.now().toString(36)}`, attachment });
      if (sent.kind === "missing") throw new Error("conversation_missing");
      setCoachWorking(true);
      const poll = setInterval(() => void hydrateCoach(session), 240);
      try {
        await conversation.whenIdle(session.id);
      } finally {
        clearInterval(poll);
        setCoachWorking(false);
      }
      await hydrateCoach(session);
      await refresh();
    } catch (cause) {
      setCoachWorking(false);
      setError(userFacingError(cause, mobileT("mobile.ui.productshell.be13ed1540")));
      if (cause instanceof Error && cause.message === "remote_llm_permission_required") throw cause;
    }
  }, [coachExpanded, coachSession, conversation, date, hydrateCoach, refresh, route, userId, workoutId]);

  const selectCoachSession = useCallback(async (sessionId: string) => {
    try {
      const opened = await conversation.execute({ kind: "open", userId, conversationId: sessionId });
      if (opened.kind !== "opened") throw new Error(mobileT("mobile.ui.productshell.9c53df839a"));
      setCoachSession(opened.conversation);
      // State updates are asynchronous. Hydrating without this explicit
      // session would reopen the previously selected thread after a resume.
      await hydrateCoach(opened.conversation);
      setCoachExpanded(true);
    } catch (cause) {
      setError(userFacingError(cause, mobileT("mobile.ui.productshell.88d93f28ce")));
    }
  }, [conversation, hydrateCoach, userId]);

  const startNewCoachConversation = useCallback(() => {
    void (async () => {
      const opened = await conversation.execute({ kind: "new", userId });
      if (opened.kind !== "opened") return;
      setCoachSession(opened.conversation);
      setCoachItems([]);
      setCoachAttachment({ sessionId: opened.conversation.id, foreground: "expanded" });
      const history = await conversation.read({ kind: "history", userId });
      if (history.kind === "history") setCoachSessions(history.conversations);
    })();
  }, [conversation, userId]);

  const stopCoach = useCallback(() => {
    if (!coachSession) return;
    void (async () => {
      await conversation.execute({ kind: "stop", userId, conversationId: coachSession.id });
      setCoachWorking(false);
      await hydrateCoach();
    })().catch((cause) => setError(userFacingError(cause, mobileT("mobile.ui.productshell.be13ed1540"))));
  }, [coachSession, conversation, hydrateCoach, userId]);

  const submitBaseline = useCallback((baseline: { ageYears: number; heightCm: number; weightKg: number; goalText?: string }) => {
    if (!coachSession) return;
    void (async () => {
      setCoachWorking(true);
      const result = await conversation.execute({ kind: "submit_baseline", userId, conversationId: coachSession.id, baseline });
      if (result.kind !== "baseline_submitted") throw new Error("baseline_not_submitted");
      await conversation.whenIdle(coachSession.id);
      await hydrateCoach();
      await refresh();
    })().catch((cause) => setError(userFacingError(cause, mobileT("mobile.ui.productshell.be13ed1540")))).finally(() => setCoachWorking(false));
  }, [coachSession, conversation, hydrateCoach, refresh, userId]);

  const saveBaselineDraft = useCallback((draft: { ageYears?: string; heightCm?: string; weightKg?: string; goalText?: string }) => {
    if (!coachSession) return;
    void conversation.execute({ kind: "save_baseline_draft", userId, conversationId: coachSession.id, draft })
      .then(() => hydrateCoach(coachSession))
      .catch((cause) => setError(userFacingError(cause, mobileT("mobile.ui.productshell.be13ed1540"))));
  }, [coachSession, conversation, hydrateCoach, userId]);

  const submitIntakeForm = useCallback((item: ConversationItem, values: Readonly<Record<string, string>>) => {
    if (!coachSession) return;
    void (async () => {
      setCoachWorking(true);
      const result = await conversation.execute({ kind: "submit_intake_form", userId, conversationId: coachSession.id, cardId: item.id, values });
      if (result.kind !== "intake_form_submitted") throw new Error("intake_form_not_submitted");
      await conversation.whenIdle(coachSession.id);
      await hydrateCoach();
      await refresh();
    })().catch((cause) => setError(userFacingError(cause, mobileT("mobile.ui.productshell.be13ed1540")))).finally(() => setCoachWorking(false));
  }, [coachSession, conversation, hydrateCoach, refresh, userId]);

  const resolveConversationCard = useCallback((item: ConversationItem, actionId: string) => {
    void (async () => {
      // Cards are durable conversation artifacts. A resumed shell can render
      // one before its in-memory session reference has rehydrated, so recover
      // that same session instead of silently dropping the user's action.
      let session = coachSession;
      if (!session && coachAttachment) {
        const opened = await conversation.execute({ kind: "open", userId, conversationId: coachAttachment.sessionId });
        if (opened.kind === "opened") {
          session = opened.conversation;
          setCoachSession(session);
        }
      }
      if (!session) throw new Error("conversation_session_unavailable");
      setCoachWorking(true);
      if (item.kind === "goal_path") {
        await conversation.execute({ kind: "resolve_goal_path", userId, conversationId: session.id, cardId: item.id, optionId: actionId as "gradual" | "balanced" | "faster" });
        await conversation.whenIdle(session.id);
      } else if (item.kind === "choice" && actionId === "record_only") {
        await conversation.execute({ kind: "choose_record_only", userId, conversationId: session.id, cardId: item.id });
      } else if (item.kind === "choice" && actionId === "continue_goal") {
        await conversation.execute({ kind: "continue_goal_discussion", userId, conversationId: session.id, cardId: item.id });
        await conversation.whenIdle(session.id);
      } else if (item.card?.kind === "plan_candidate" && (actionId === "confirm" || actionId === "reject")) {
        await conversation.execute({ kind: "resolve_plan_candidate", userId, conversationId: session.id, cardId: item.id, decision: actionId });
      } else if (item.card?.kind === "record_confirmation" && (actionId === "confirm" || actionId === "reject")) {
        await conversation.execute({ kind: "resolve_record", userId, conversationId: session.id, cardId: item.id, decision: actionId });
      } else if (item.card?.kind === "receipt" && actionId === "correct_record") {
        await conversation.execute({ kind: "request_correction", userId, conversationId: session.id, cardId: item.id });
        await conversation.whenIdle(session.id);
      }
      await hydrateCoach(session);
      await refresh();
    })().catch((cause) => {
      // 卡片操作失败必须留下可诊断的痕迹：用户看到的是兜底文案，真实原因进控制台。
      console.error("coach_card_action_failed", cause instanceof Error ? (cause.stack ?? cause.message) : cause);
      setError(userFacingError(cause, mobileT("mobile.ui.productshell.be13ed1540")));
    }).finally(() => setCoachWorking(false));
  }, [coachAttachment, coachSession, conversation, hydrateCoach, refresh, userId]);

  const handleCoachExpandedChange = useCallback((expanded: boolean) => {
    setCoachExpanded(expanded);
    setCoachAttachment((current) => current ? { ...current, foreground: expanded ? "expanded" : "minimized" } : current);
    if (expanded) void hydrateCoach();
  }, [hydrateCoach]);

  /** The collapsed dock declares the input intent before its composer grows into the conversation surface. */
  const openCoachFromDock = useCallback(() => {
    setCoachFocusRequest((current) => current + 1);
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
      const history = await conversation.read({ kind: "history", userId });
      if (active && history.kind === "history") setCoachSessions(history.conversations);
      const attachment = recovery.state.coachAttachment;
      if (attachment) {
        const opened = await conversation.execute({ kind: "open", userId, conversationId: attachment.sessionId });
        if (!active) return;
        if (opened.kind === "opened") {
          setCoachSession(opened.conversation);
          setCoachAttachment({ sessionId: opened.conversation.id, foreground: attachment.foreground });
          setCoachExpanded(attachment.foreground === "expanded");
          if (attachment.foreground === "expanded") await hydrateCoach();
        } else {
          setCoachAttachment(undefined);
          setCoachExpanded(false);
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
  }, [application, conversation, hydrateCoach, initialProductShellRecovery, userId]);

  const presentationState = useMemo<ProductShellState>(() => {
    const persistableRoute = isProductDeepLinkRoute(route) ? route : "today";
    const attachment = coachAttachment
      ? { ...coachAttachment, foreground: coachExpanded ? "expanded" as const : "minimized" as const }
      : undefined;
    const unfinishedForm = showActivityLog
        ? { kind: "activity_log" as const, recovery: "discard_on_process_restore" as const }
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
  }, [calendarMode, coachAttachment, coachExpanded, date, route, showActivityLog, workoutId]);

  useEffect(() => {
    if (!productShellStateStore || !shellRestorationReady) return;
    let mounted = true;
    productShellSaveChain.current = productShellSaveChain.current
      .catch(() => undefined)
      .then(() => productShellStateStore.save({ userId, state: presentationState }))
      .catch(() => {
        if (mounted) setError(mobileT("mobile.ui.productshell.d8a2cbad47"));
      });
    return () => { mounted = false; };
  }, [presentationState, productShellStateStore, shellRestorationReady, userId]);

  const commitProductRoute = useCallback((nextRoute: ProductRoute) => {
    if (nextRoute === "today" || nextRoute === "plan") setDate(localDate());
    setRoute(nextRoute);
  }, []);

  const navigateProductRoute = useCallback((nextRoute: ProductRoute) => {
    if (isPrimaryProductRoute(route) && isPrimaryProductRoute(nextRoute) && primaryPager.current) {
      primaryPager.current.navigate(nextRoute);
      return;
    }
    commitProductRoute(nextRoute);
  }, [commitProductRoute, route]);

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
            content: <TodayScreen application={application} userId={userId} screen={screen} onOpenCalendar={() => navigateProductRoute("calendar")} onOpenCoach={() => handleCoachExpandedChange(true)} onBeginWorkout={requestWorkoutStart} onRecordActivity={() => { setActivityLogInitialMode("activity"); setShowActivityLog(true); }} onRecordMeal={() => { setActivityLogInitialMode("nutrition"); setShowActivityLog(true); }} onCheckIn={() => { setActivityLogInitialMode("recovery"); setShowActivityLog(true); }} onViewWorkoutSummary={setWorkoutSummary} onCorrectTimeline={setTimelineCorrection} />,
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
            content: <PlanScreen initialTab="overview" application={application} userId={userId} screen={screen} onRecordMeal={() => { setActivityLogInitialMode("nutrition"); setShowActivityLog(true); }} onOpenCoach={() => handleCoachExpandedChange(true)} onUpdated={() => void refresh()} />,
          },
          {
            id: "profile",
            content: <ProfileScreen application={application} userId={userId} screen={screen} onOpenAccountSettings={onOpenAccountSettings} onUpdated={() => void refresh()} />,
          },
        ]}
      /> : null}
      {route === "workout" && workoutId ? <WorkoutScreen application={application} userId={userId} workoutId={workoutId} onOpenCoach={() => handleCoachExpandedChange(true)} onFinished={() => { setWorkoutId(undefined); setRoute("today"); refreshAfterFormalWrite(); }} onUnavailable={() => { setWorkoutId(undefined); setRoute("today"); void refresh(); }} /> : null}
      {error ? <View style={styles.inlineError}><Text style={styles.inlineErrorText}>{error}</Text></View> : null}
      {route !== "workout" ? <ProductDock route={route} coachBusy={coachWorking} coachExpanded={coachExpanded} onChange={navigateProductRoute} onRecord={() => { setActivityLogInitialMode("picker"); setShowActivityLog(true); }} onOpenCoach={openCoachFromDock} onCoachAnchorChange={setCoachComposerAnchor} /> : null}
      {coachDrawerAvailableForRoute(route) ? <CoachDrawer
        session={coachSession}
        conversationItems={coachItems}
        onSubmitBaseline={submitBaseline}
        onSaveBaselineDraft={saveBaselineDraft}
        onSubmitIntakeForm={submitIntakeForm}
        onConversationCardAction={resolveConversationCard}
        sessions={coachSessions}
        expanded={coachExpanded}
        onboarding={Boolean(screen && !screen.profile.profileReady)}
        bottomInset={screen && !screen.profile.profileReady ? 0 : route === "workout" ? 16 : APP_DOCK_BODY_HEIGHT}
        horizontalInset={screen && !screen.profile.profileReady ? 0 : 8}
        dockedComposer={route !== "workout" && Boolean(screen?.profile.profileReady)}
        composerAnchor={route === "workout" || !screen?.profile.profileReady ? undefined : coachComposerAnchor}
        focusRequest={coachFocusRequest}
        onExpandedChange={handleCoachExpandedChange}
        onSend={(text) => void sendToCoach(text)}
        onSelectSession={(sessionId) => void selectCoachSession(sessionId)}
        onStartNew={startNewCoachConversation}
        onStop={stopCoach}
        running={coachWorking}
      /> : null}
      <RecordFocus
        records={records}
        userId={userId}
        initialMode={activityLogInitialMode}
        referenceWeightKg={screen.profile.referenceWeightKg}
        syncedSleepMinutes={latestImportedSleepMinutes(screen.today.activityLog.entries)}
        visible={showActivityLog}
        onDismiss={() => setShowActivityLog(false)}
        onSaved={() => { setShowActivityLog(false); refreshAfterFormalWrite(); }}
        onStartFreestyleWorkout={requestWorkoutStart}
      />
      {timelineCorrection ? <TimelineCorrectionSheet records={records} userId={userId} entry={timelineCorrection} onDismiss={() => setTimelineCorrection(undefined)} onSaved={() => { setTimelineCorrection(undefined); refreshAfterFormalWrite(); }} /> : null}
      {workoutSummary ? <WorkoutOutcomeSummarySheet summary={workoutSummary} onDismiss={() => setWorkoutSummary(undefined)} onCorrect={() => { setWorkoutCorrectionId(workoutSummary.id); setWorkoutSummary(undefined); }} /> : null}
      {workoutCorrectionId ? <WorkoutOutcomeCorrectionSheet application={application} userId={userId} workoutId={workoutCorrectionId} onDismiss={() => setWorkoutCorrectionId(undefined)} onSaved={() => { setWorkoutCorrectionId(undefined); refreshAfterFormalWrite(); }} /> : null}
    </View>
  );
}

function TodayScreen({ screen, onOpenCalendar, onOpenCoach, onBeginWorkout, onRecordActivity, onRecordMeal, onCheckIn, onViewWorkoutSummary, onCorrectTimeline }: { application: LocalProductKernel; userId: string; screen: CoachProductProjection; onOpenCalendar: () => void; onOpenCoach: () => void; onBeginWorkout: () => void; onRecordActivity: () => void; onRecordMeal: () => void; onCheckIn: () => void; onViewWorkoutSummary: (summary: WorkoutOutcomeProductSummary) => void; onCorrectTimeline: (entry: TimelineReadEvent) => void }) {
  const { today, coach } = screen;
  const [dashboardTab, setDashboardTab] = useState<"training" | "nutrition">("training");
  return (
    <ScrollView contentContainerStyle={[styles.content, styles.dockContent]} showsVerticalScrollIndicator={false}>
      <View style={styles.todayHeader}>
        <View><Text style={styles.todayKicker}>{mobileT("mobile.ui.productshell.20c296b7b1")}{weekDayLabel(today.date)}</Text><Text style={styles.date}>{shortDate(today.date)}</Text></View>
        <Pressable accessibilityRole="button" accessibilityLabel={mobileT("mobile.ui.productshell.2a8dbcfb8d")} hitSlop={10} onPress={onOpenCalendar}>
          <Text style={styles.calendarLink}>{mobileT("mobile.ui.productshell.2ecbc11608")}</Text>
        </Pressable>
      </View>
      <DashboardFlipCard
        value={dashboardTab}
        training={<TodayCard today={today} onFlip={() => setDashboardTab("nutrition")} onBeginWorkout={onBeginWorkout} onRecordActivity={onRecordActivity} onViewWorkoutSummary={onViewWorkoutSummary} />}
        nutrition={<NutritionLedgerCard nutrition={today.nutrition} onFlip={() => setDashboardTab("training")} onRecordMeal={onRecordMeal} />}
      />
      {dashboardTab === "training" ? <RecoveryStatusCard recovery={today.recovery} onCheckIn={onCheckIn} /> : null}
      {today.goalPathSignal ? <Pressable accessibilityRole="button" onPress={onOpenCoach} style={styles.pendingPreviewCard}><View>{today.goalPathSignal.goalPathAssessment ? <Text style={styles.pendingPreviewKicker}>{goalPathStateLabel(today.goalPathSignal.goalPathAssessment.assessment.state)}</Text> : null}<Text style={styles.pendingPreviewTitle}>{today.goalPathSignal.title}</Text><Text style={styles.pendingPreviewMeta}>{today.goalPathSignal.summary.slice(0, 2).join("；")}</Text></View><Text style={styles.pendingPreviewArrow}>›</Text></Pressable> : null}
      {today.activityLog.entries.length ? <>
        <SectionHeading title={mobileT("mobile.ui.productshell.3b6d4b8a60")} meta={mobileT("mobile.ui.productshell.a8be842b1b", { value0: today.activityLog.entries.length })} />
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
  const label = recovery.level === "normal" ? mobileT("mobile.ui.productshell.c177e6ac8c") : recovery.level === "slight_reduction" ? mobileT("mobile.ui.productshell.e921a3c856") : recovery.level === "recovery_priority" ? mobileT("mobile.ui.productshell.41ef55f740") : mobileT("mobile.ui.productshell.ce4faf591f");
  return <View style={styles.recoveryStatusCard}>
      <View style={styles.sectionHeader}><View><Text style={[styles.cardEyebrow, styles.intakeEyebrow]}>{mobileT("mobile.ui.productshell.185bea2b62")}</Text><Text style={styles.detailTitle}>{label}</Text></View><Text style={styles.detailMeta}>{recovery.validUntil ? mobileT("mobile.ui.productshell.5089cbcba8", { value0: recovery.validUntil.slice(0, 10) }) : mobileT("mobile.ui.productshell.ae482564fc")}</Text></View>
    <Text style={styles.detailMeta}>{recovery.reasons.map((reason) => recoveryReasonLabel(reason)).join("、") || mobileT("mobile.ui.productshell.fc88757e91")}</Text>
    {recovery.missing.length ? <Text style={styles.detailMeta}>{mobileT("mobile.ui.productshell.c3a296cafd")}{recovery.missing.map((reason) => recoveryReasonLabel(reason)).join("、")}</Text> : null}
    <Pressable accessibilityRole="button" onPress={onCheckIn} style={styles.recoveryCheckInButton}><Text style={styles.recoveryCheckInText}>{mobileT("mobile.ui.productshell.d67a417a5b")}</Text></Pressable>
  </View>;
}

function NutritionLedgerCard({ nutrition, onFlip, onRecordMeal }: { nutrition: CoachProductProjection["today"]["nutrition"]; onFlip: () => void; onRecordMeal: () => void }) {
  const labels = { protein: mobileT("mobile.ui.productshell.fcf373f67b"), carbohydrate: mobileT("mobile.ui.productshell.3215da61d1"), fat: mobileT("mobile.ui.productshell.2eef1156d9"), fiber: mobileT("mobile.nutrient.fiber"), sodium: mobileT("mobile.nutrient.sodium"), potassium: mobileT("mobile.nutrient.potassium"), calcium: mobileT("mobile.nutrient.calcium"), iron: mobileT("mobile.nutrient.iron"), magnesium: mobileT("mobile.nutrient.magnesium"), vitamin_c: mobileT("mobile.nutrient.vitaminC") } as const;
  return <View style={[styles.nutritionLedgerCard, styles.dashboardNutritionCard]}>
    <View style={styles.nutritionCardHeader}>
      <Text style={styles.nutritionCardTitle}>{mobileT("mobile.ui.productshell.d4f0ba3885")}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={mobileT("mobile.ui.productshell.40bb29e9f1")} onPress={onFlip} style={({ pressed }) => [styles.cardFlipButtonLight, pressed && styles.cardFlipButtonPressed]}><Text style={styles.cardFlipButtonLightText}>{mobileT("mobile.ui.productshell.ca9a3c441c")}</Text></Pressable>
    </View>
    <View style={styles.intakeOverviewRow}>
      <DailyFuelRing ledger={nutrition.healthLedger} size={132} />
      <View style={styles.intakeOverviewCopy}>
        <Text style={styles.intakeDayLabel}>{mobileT("mobile.ui.productshell.65a31eda73")}</Text>
        <Text style={styles.intakeTargetValue}>{ledgerTargetKcal(nutrition.healthLedger)?.toLocaleString() ?? "—"}</Text>
        <Text style={styles.intakeTargetUnit}>kcal</Text>
        {nutrition.healthLedger.nutritionPlan.targets.energy.range ? <Text style={styles.intakeTargetRange}>{nutrition.healthLedger.nutritionPlan.targets.energy.range.min.toLocaleString()}–{nutrition.healthLedger.nutritionPlan.targets.energy.range.max.toLocaleString()}</Text> : null}
      </View>
    </View>
    <View style={styles.nutritionMacroStrip}>
      {(Object.keys(labels) as (keyof typeof labels)[]).map((nutrient) => {
        const value = nutrition.ledger.nutrients[nutrient];
        if (!value) return null;
        const target = value.target;
        return <View key={nutrient} style={styles.nutritionMacroItem}><Text style={styles.nutritionProgressLabel}>{labels[nutrient]}</Text><Text style={styles.nutritionMacroValue}>{value.intakeKnown ? `${Math.round(value.consumedLogged)} ${value.unit}` : "—"}</Text>{target === undefined ? null : <Text style={styles.nutritionProgressMeta}>{mobileT("mobile.ui.productshell.941f08313a")}{Math.round(target)} {value.unit}</Text>}</View>;
      })}
    </View>
    {nutrition.ledger.meals.length ? <View style={styles.nutritionMealList}>{nutrition.ledger.meals.map((meal) => { const energy = meal.nutrients?.find((value) => value.nutrientId === "energy")?.amount; return <View key={meal.eventId} style={styles.nutritionMealRow}><Text style={styles.nutritionMealTitle}>{meal.description ?? meal.slot}</Text><Text style={styles.nutritionMealMeta}>{meal.confirmed ? mobileT("mobile.ui.productshell.d9fea67ad2") : mobileT("mobile.ui.productshell.27b5842c97")}{energy !== undefined ? ` · ${Math.round(energy)} kcal` : mobileT("mobile.ui.productshell.57afd9deea")}</Text></View>; })}</View> : null}
    <View style={styles.nutritionButtonRow}><Pressable accessibilityRole="button" onPress={onRecordMeal} style={styles.nutritionRecordButton}><Text style={styles.nutritionRecordButtonText}>{mobileT("mobile.ui.productshell.58c95b36bd")}</Text></Pressable></View>
  </View>;
}

function DailyFuelRing({ ledger, size = 148 }: { ledger: DailyHealthLedger; size?: number }) {
  const palette = intakePalette(ledgerIntakeStatus(ledger));
  const center = size / 2;
  const radiusValue = center - 15;
  const circumference = 2 * Math.PI * radiusValue;
  const progressRatio = ledgerProgressRatio(ledger);
  const consumedKcal = ledgerConsumedKcal(ledger);
  const progress = clampNumber(progressRatio ?? 0, 0, 1);
  const overflow = clampNumber((progressRatio ?? 1) - 1, 0, 0.25) / 0.25;
  const percentage = progressRatio === undefined ? undefined : Math.round(progressRatio * 100);
  return <View accessibilityLabel={consumedKcal === undefined
    ? mobileT("mobile.ui.productshell.6e39714d90")
    : percentage === undefined
      ? mobileT("mobile.productShell.intake.consumedWithoutTarget", { consumed: consumedKcal })
      : mobileT("mobile.ui.productshell.58fb1ff0b4", { value0: consumedKcal, value1: percentage })} style={[styles.intakeRingWrap, { width: size, height: size }]}>
    <Svg width={size} height={size}>
      <Circle cx={center} cy={center} r={radiusValue} fill="none" stroke={colors.paper2} strokeWidth={10} />
      <Circle cx={center} cy={center} r={radiusValue} fill="none" stroke={palette.color} strokeWidth={10} strokeLinecap="round" strokeDasharray={`${circumference} ${circumference}`} strokeDashoffset={circumference * (1 - progress)} transform={`rotate(-90 ${center} ${center})`} />
      {overflow > 0 ? <Circle cx={center} cy={center} r={radiusValue + 8} fill="none" stroke={palette.color} strokeWidth={3} strokeLinecap="round" strokeDasharray={`${2 * Math.PI * (radiusValue + 8)} ${2 * Math.PI * (radiusValue + 8)}`} strokeDashoffset={2 * Math.PI * (radiusValue + 8) * (1 - overflow)} transform={`rotate(-90 ${center} ${center})`} /> : null}
    </Svg>
    <View style={styles.intakeRingCenter}>
      <Text style={[styles.intakeRingValue, { color: palette.ink }]}>{consumedKcal === undefined ? "—" : consumedKcal.toLocaleString()}</Text>
      <Text style={styles.intakeRingUnit}>kcal</Text>
      {percentage !== undefined ? <Text style={[styles.intakeRingPercent, { color: palette.ink }]}>{percentage}%</Text> : null}
    </View>
  </View>;
}

function CoachNotice({ screen, onOpenCoach }: { screen: CoachProductProjection; onOpenCoach: () => void }) {
  const notice = screen.coach.pending
    ? mobileT("mobile.ui.productshell.8508e96aad")
    : screen.coach.goalCompletionNext === "goal_negotiation"
      ? mobileT("mobile.plan.completion.nextGoal")
      : screen.coach.goalCompletionNext === "maintenance_planning"
        ? mobileT("mobile.plan.completion.nextMaintenance")
    : screen.coach.latestUndoableAction
      ? mobileT("mobile.ui.productshell.7fe325a839")
      : undefined;
  if (!notice) return <View style={styles.noticeSpacer} />;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={mobileT("mobile.ui.productshell.d11d944699")} onPress={onOpenCoach} style={styles.coachNotice}>
      <View style={styles.noticeDot} />
      <Text style={styles.coachNoticeText}>{notice}</Text>
      <Text style={styles.noticeChevron}>›</Text>
    </Pressable>
  );
}

function TodayCard({ today, onFlip, onBeginWorkout, onRecordActivity, onViewWorkoutSummary }: { today: CoachProductProjection["today"]; onFlip: () => void; onBeginWorkout: () => void; onRecordActivity: () => void; onViewWorkoutSummary: (summary: WorkoutOutcomeProductSummary) => void }) {
  const copy = todayCopy(today);
  const canTakeAction = ["start_workout", "continue_workout", "record_activity"].includes(today.action) || (today.action === "view_summary" && Boolean(today.completedWorkout));
  const takeAction = () => {
    if (today.action === "record_activity") onRecordActivity();
    else if (today.action === "view_summary" && today.completedWorkout) onViewWorkoutSummary(today.completedWorkout);
    else if (today.action === "start_workout" || today.action === "continue_workout") onBeginWorkout();
  };
  return (
    <View style={styles.todayCard}>
      <View style={styles.summaryArea}>
        <Pressable accessibilityRole="button" accessibilityLabel={mobileT("mobile.ui.productshell.c42f1a2140")} onPress={onFlip} style={({ pressed }) => [styles.cardFlipButtonDark, pressed && styles.cardFlipButtonPressed]}><Text style={styles.cardFlipButtonDarkText}>{mobileT("mobile.ui.productshell.4d06db95b6")}</Text></Pressable>
        <Text style={styles.cardEyebrow}>{mobileT("mobile.ui.productshell.8edd0f641d")}</Text>
        <Text style={styles.planTitle} numberOfLines={2}>{today.session ? readablePlanSessionTitle(today.session.title) : copy.title}</Text>
        <Text style={styles.planSubtitle} numberOfLines={1}>{copy.subtitle}</Text>
        <View style={styles.metricsRow}>
          <Metric value={today.session?.estimatedMinutes ? `${today.session.estimatedMinutes}′` : "—"} label={mobileT("mobile.ui.productshell.d84ee81f27")} />
          <Metric value={today.session ? String(today.session.totalSetCount || today.session.taskCount) : "—"} label={today.session?.kind === "cardio" ? mobileT("mobile.ui.productshell.08f87c580d") : mobileT("mobile.ui.productshell.1fcfb573d2")} />
          <Metric value={today.activeWorkout?.status === "paused" ? mobileT("mobile.ui.productshell.fcbae46bf8") : today.activeWorkout?.status === "active" ? mobileT("mobile.ui.productshell.6f1972e48e") : today.session?.kind === "rest" ? mobileT("mobile.ui.productshell.79748ca1c6") : ""} label={mobileT("mobile.ui.productshell.62e951a692")} />
        </View>
      </View>
      <View style={styles.taskArea}>
        {today.session?.actions.length ? (
          <ScrollView nestedScrollEnabled showsVerticalScrollIndicator={false} contentContainerStyle={styles.taskScroll}>
            {today.session.actions.map((task, index) => (
              <View style={styles.taskRow} key={task.id}>
                <Text numberOfLines={1} style={styles.taskName}>{humanizeExerciseLabel(task.label)}</Text>
                <ProfessionalTermText numberOfLines={1} text={`${task.summary}${task.targetRir !== undefined ? ` · RIR ${task.targetRir}` : ""}`} style={styles.taskSummary} />
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
      <Pressable accessibilityRole="button" accessibilityLabel={mobileT("mobile.ui.productshell.b41a0c627c")} onPress={onDismiss} style={StyleSheet.absoluteFill} />
      <View style={styles.outcomeSheet}>
        <View style={styles.sheetHandle} />
        <Text style={styles.cardEyebrow}>{mobileT("mobile.ui.productshell.e14bc9de1f")}</Text>
        <Text style={styles.outcomeTitle}>{readablePlanSessionTitle(summary.title)}</Text>
        <Text style={styles.outcomeStatus}>{outcomeStatusLabel(summary.status)}</Text>
        <View style={styles.outcomeMetricRow}>
          <OutcomeMetric value={String(summary.completedWorkSets)} label={mobileT("mobile.ui.productshell.61ec828096")} />
          <OutcomeMetric value={String(summary.incompleteSetCount)} label={mobileT("mobile.ui.productshell.a66108ea5d")} />
          <OutcomeMetric value={outcomeCompletenessLabel(summary.dataCompleteness)} label={mobileT("mobile.ui.productshell.d82c9100ca")} />
        </View>
        <View style={styles.outcomeFacts}>
          <View style={styles.outcomeFactRow}><Text style={styles.outcomeFactLabel}>{mobileT("mobile.ui.productshell.d0f48e113d")}</Text><Text style={styles.outcomeFactValue}>{shortDate(summary.scheduledFor)}</Text></View>
          <View style={styles.outcomeFactRow}><Text style={styles.outcomeFactLabel}>{mobileT("mobile.ui.productshell.997dcb12b3")}</Text><Text style={styles.outcomeFactValue}>{localDateTime(summary.completedAt)}</Text></View>
        </View>
        <Text style={styles.outcomeBoundary}>{mobileT("mobile.ui.productshell.bebc8eb050")}</Text>
        <Pressable accessibilityRole="button" onPress={onCorrect} style={styles.outcomeCorrectionButton}><Text style={styles.outcomeCorrectionButtonText}>{mobileT("mobile.ui.productshell.db7f3467f5")}</Text></Pressable>
        <Pressable accessibilityRole="button" onPress={onDismiss} style={styles.primaryButton}><Text style={styles.primaryButtonText}>{mobileT("mobile.ui.productshell.33246f6a5e")}</Text></Pressable>
      </View>
    </View>
  );
}

function OutcomeMetric({ value, label }: { value: string; label: string }) {
  return <View style={styles.outcomeMetric}><Text style={styles.outcomeMetricValue} numberOfLines={1}>{value}</Text><Text style={styles.outcomeMetricLabel}>{label}</Text></View>;
}

/** A low-friction, offline-first entry point for the day's factual Timeline. */
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
        <Text style={styles.detailTitle}>{calendar.selected.date === today ? mobileT("mobile.ui.productshell.4bceaea0e4") : mobileT("mobile.ui.productshell.02d90aff65")}</Text>
        {calendar.selected.performedWorkouts.map((summary) => (
          <Pressable key={summary.id} accessibilityRole="button" accessibilityLabel={mobileT("mobile.ui.productshell.bd1240e203", { value0: readablePlanSessionTitle(summary.title) })} onPress={() => props.onViewWorkoutSummary(summary)} style={styles.performedWorkoutRow}>
            <View style={styles.performedWorkoutCopy}>
              <Text style={styles.performedWorkoutTitle}>{readablePlanSessionTitle(summary.title)}</Text>
              <Text style={styles.performedWorkoutMeta}>{outcomeStatusLabel(summary.status)} · {summary.completedWorkSets} {mobileT("mobile.ui.productshell.7e8e8e94a6")}{localDateTime(summary.completedAt).slice(-5)}</Text>
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

function PlanScreen({ application, userId, screen, initialTab, onRecordMeal, onOpenCoach, onUpdated }: { application: LocalProductKernel; userId: string; screen: CoachProductProjection; initialTab: PlanWorkspaceTab; onRecordMeal: () => void; onOpenCoach: () => void; onUpdated: () => void }) {
  const { plan } = screen;
  const [activeTab, setActiveTab] = useState<PlanWorkspaceTab>(initialTab);
  const [completionProposal, setCompletionProposal] = useState<EvidenceBriefArtifact>();
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState<string>();
  const pauseCurrentPlan = async () => {
    setPreviewBusy(true);
    try {
      const mutationKey = `mobile-plan:pause:${Date.now().toString(36)}`;
      await application.pausePlan({ userId, reason: "user_paused", idempotencyKey: mutationKey });
      setPreviewError(undefined);
      onUpdated();
    } catch (cause) {
      setPreviewError(userFacingError(cause, mobileT("mobile.ui.productshell.1cdd25e544")));
    } finally {
      setPreviewBusy(false);
    }
  };
  const reopenCurrentPlanning = async () => {
    setPreviewBusy(true);
    try {
      const mutationKey = `mobile-plan:reopen:${Date.now().toString(36)}`;
      await application.reopenPlanning({ userId, idempotencyKey: mutationKey });
      setPreviewError(undefined);
      onUpdated();
      onOpenCoach();
    } catch (cause) {
      setPreviewError(userFacingError(cause, mobileT("mobile.ui.productshell.0a9b0c6d48")));
    } finally {
      setPreviewBusy(false);
    }
  };
  const checkGoalCompletion = async () => {
    setPreviewBusy(true);
    try {
      const proposal = await application.proposeGoalCompletion({ userId, timezoneOffsetMinutes: new Date().getTimezoneOffset() * -1, idempotencyKey: `mobile-goal-completion:${Date.now().toString(36)}` });
      setCompletionProposal(proposal);
      setPreviewError(undefined);
    } catch (cause) {
      setPreviewError(userFacingError(cause, mobileT("mobile.plan.completion.unavailable")));
    } finally {
      setPreviewBusy(false);
    }
  };
  const resolveCompletion = async (resolution: "reject" | "confirm_and_record_only" | "confirm_and_maintain" | "confirm_and_request_new_goal") => {
    if (!completionProposal?.goalCompletionProposal) return;
    setPreviewBusy(true);
    try {
      const mutationKey = `mobile-goal-completion:${resolution}:${completionProposal.id}`;
      const result = await application.resolveGoalCompletion({ userId, proposalId: completionProposal.id, resolution, idempotencyKey: mutationKey });
      setCompletionProposal(undefined);
      setPreviewError(undefined);
      onUpdated();
      if (result.status === "completed" && (result.next === "goal_negotiation" || result.next === "maintenance_planning")) onOpenCoach();
    } catch (cause) {
      setPreviewError(userFacingError(cause, mobileT("mobile.plan.completion.stale")));
    } finally {
      setPreviewBusy(false);
    }
  };
  return (
    <View style={styles.planPage}>
      <View style={styles.planFixedHeader}>
        <View style={styles.planTitleRow}>
          <View><Text style={styles.screenTitle}>{mobileT("mobile.ui.productshell.ff5c3df60f")}</Text><Text style={styles.screenSub}>{plan.horizon ? `${shortDate(plan.horizon.startDate)}—${shortDate(plan.horizon.endDate)}` : mobileT("mobile.ui.productshell.85c4af69e2")}</Text></View>
        </View>
        <SegmentedControl<PlanWorkspaceTab> compact value={activeTab} onChange={setActiveTab} options={[{ id: "overview", label: mobileT("mobile.ui.productshell.5060421d15") }, { id: "training", label: mobileT("mobile.ui.productshell.796e01d5af") }, { id: "intake", label: mobileT("mobile.ui.productshell.7eb82652f0") }, { id: "trends", label: mobileT("mobile.ui.productshell.376df657e6") }]} />
      </View>
      <ScrollView key={activeTab} contentContainerStyle={styles.planTabContent} showsVerticalScrollIndicator={false}>
        {plan.status === "unavailable" && activeTab !== "trends" ? <><Empty label={mobileT("mobile.ui.productshell.3b5b7d6265")} />{plan.lifecycleState === "paused" || plan.lifecycleState === "planning_required" ? <Pressable accessibilityRole="button" disabled={previewBusy} onPress={() => void reopenCurrentPlanning()} style={styles.reportConfirmButton}><Text style={styles.reportConfirmText}>{mobileT("mobile.plan.lifecycle.replan")}</Text></Pressable> : null}{plan.lifecycleState === "completed" ? <Pressable accessibilityRole="button" onPress={onOpenCoach} style={styles.reportConfirmButton}><Text style={styles.reportConfirmText}>{mobileT("mobile.plan.lifecycle.discussNext")}</Text></Pressable> : null}</> : null}
        {plan.status === "stale" ? <Empty label={mobileT("mobile.ui.productshell.5eccce9221")} /> : null}
          {plan.status === "current" && activeTab === "overview" ? <PlanOverview screen={screen} onOpenTrends={() => setActiveTab("trends")} /> : null}
        {plan.status === "current" && activeTab === "training" ? <TrainingPlanTab plan={plan} locale={screen.profile.locale} /> : null}
        {plan.status === "current" && activeTab === "intake" ? <IntakePlanTab screen={screen} onRecordMeal={onRecordMeal} /> : null}
        {activeTab === "trends" ? <PlanTrends application={application} userId={userId} screen={screen} onUpdated={onUpdated} /> : null}
      </ScrollView>
      {plan.status === "current" ? <View style={styles.planLifecycleActions}><Pressable accessibilityRole="button" disabled={previewBusy} onPress={() => void checkGoalCompletion()} style={styles.pauseButton}><Text style={styles.pauseButtonText}>{mobileT("mobile.plan.completion.check")}</Text></Pressable><Pressable accessibilityRole="button" disabled={previewBusy} onPress={() => void pauseCurrentPlan()} style={styles.pauseButton}><Text style={styles.pauseButtonText}>{mobileT("mobile.ui.productshell.de0ebad8bf")}</Text></Pressable></View> : null}
      <BottomDrawer visible={Boolean(completionProposal)} title={completionProposal?.title ?? mobileT("mobile.plan.completion.candidate")} subtitle={mobileT("mobile.plan.completion.userOnly")} onDismiss={() => setCompletionProposal(undefined)}>
        {completionProposal ? <View style={styles.completionProposal}><Text style={styles.completionProposalText}>{completionProposal.summary.join("\n")}</Text>{previewError ? <Text style={styles.errorText}>{previewError}</Text> : null}<Pressable accessibilityRole="button" disabled={previewBusy} onPress={() => void resolveCompletion("confirm_and_record_only")} style={styles.reportConfirmButton}><Text style={styles.reportConfirmText}>{mobileT("mobile.plan.completion.recordOnly")}</Text></Pressable><Pressable accessibilityRole="button" disabled={previewBusy} onPress={() => void resolveCompletion("confirm_and_maintain")} style={styles.previewRejectButton}><Text style={styles.previewRejectText}>{mobileT("mobile.plan.completion.maintain")}</Text></Pressable><Pressable accessibilityRole="button" disabled={previewBusy} onPress={() => void resolveCompletion("confirm_and_request_new_goal")} style={styles.previewRejectButton}><Text style={styles.previewRejectText}>{mobileT("mobile.plan.completion.newGoal")}</Text></Pressable><Pressable accessibilityRole="button" disabled={previewBusy} onPress={() => void resolveCompletion("reject")} style={styles.previewRejectButton}><Text style={styles.previewRejectText}>{mobileT("mobile.plan.completion.reject")}</Text></Pressable></View> : null}
      </BottomDrawer>
    </View>
  );
}

function PlanOverview({ screen, onOpenTrends }: { screen: CoachProductProjection; onOpenTrends(): void }) {
  const { plan, progress, today } = screen;
  const locale = screen.profile.locale;
  const phase = progress.metrics.find((metric) => metric.name === "phase_progress");
  const trainingDays = plan.currentWeek.filter((session) => session.kind !== "rest" && session.kind !== "recovery" && session.taskCount > 0).length;
  const remaining = plan.horizon ? Math.max(0, dateDistance(localDate(), plan.horizon.endDate)) : undefined;
  const composite = progress.strengthTrends.composite.at(-1)?.index;
  return <>
    <View style={styles.cycleHero}>
      <View style={styles.reportCoverTop}><Text style={styles.reportKicker}>{mobileT("mobile.ui.productshell.bb4bf3b6ee")}{plan.revision ?? 0} {mobileT("mobile.ui.productshell.3da4ed2a6f")}</Text><View style={styles.reportStatus}><View style={styles.reportStatusDot} /><Text style={styles.reportStatusText}>{mobileT("mobile.ui.productshell.1f425b6bf0")}</Text></View></View>
      <Text style={styles.cycleHeroLabel}>{mobileT("mobile.ui.productshell.37f3513176")}</Text>
      <Text style={styles.cycleHeroTitle}>{strategyName(plan.strategySelection?.primary ?? "unknown", locale)}</Text>
      <Text style={styles.cycleHeroCopy}>{plan.horizon ? `${plan.horizon.startDate} → ${plan.horizon.endDate}` : mobileT("mobile.ui.productshell.66f0e40be2")}</Text>
      <View style={styles.cycleProgressRail}><View style={[styles.cycleProgressFill, { flex: Math.max(0.02, Math.min(1, phase?.value.score ?? 0)) }]} /><View style={{ flex: Math.max(0.001, 1 - Math.max(0.02, Math.min(1, phase?.value.score ?? 0))) }} /></View>
      <View style={styles.reportMetricGrid}><ReportMetric value={mobileT("mobile.ui.productshell.a9cc46ba8b", { value0: trainingDays })} label={mobileT("mobile.ui.productshell.479d143315")} /><ReportMetric value={remaining === undefined ? "—" : mobileT("mobile.ui.productshell.a9cc46ba8b", { value0: remaining })} label={mobileT("mobile.ui.productshell.bcccd6b52e")} /><ReportMetric value={composite === undefined ? mobileT("mobile.ui.productshell.78081971e6") : `${composite}`} label={mobileT("mobile.ui.productshell.52851e6cb5")} /></View>
    </View>

    <SectionHeading title={mobileT("mobile.ui.productshell.7cb8b108e3")} meta={mobileT("mobile.ui.productshell.e919f3425a")} />
    <View style={styles.behaviorGrid}>
      <BehaviorCard mark={mobileT("mobile.ui.productshell.8eeeee1f77")} title={mobileT("mobile.ui.productshell.796e01d5af")} value={today.session ? readablePlanSessionTitle(today.session.title) : mobileT("mobile.ui.productshell.e03c88bda9")} meta={today.session ? sessionMeta(today.session) : mobileT("mobile.ui.productshell.35644a8f7c")} />
      <BehaviorCard mark={mobileT("mobile.ui.productshell.d46696735b")} title={mobileT("mobile.ui.productshell.ff39dd8692")} value={ledgerTargetKcal(today.nutrition.healthLedger) === undefined ? mobileT("mobile.ui.productshell.316dd87f08") : `${ledgerTargetKcal(today.nutrition.healthLedger)!.toLocaleString()} kcal`} meta={intakeAdjustmentSummary(today.nutrition.healthLedger)} />
      <BehaviorCard mark={mobileT("mobile.ui.productshell.4f69065f13")} title={mobileT("mobile.ui.productshell.79748ca1c6")} value={recoveryLevelLabel(today.recovery.level)} meta={today.recovery.reasons.map((reason) => recoveryReasonLabel(reason, locale)).join("、") || mobileT("mobile.ui.productshell.8dfdae9fee")} />
    </View>

    <Pressable accessibilityRole="button" accessibilityLabel={mobileT("mobile.ui.productshell.caceaad286")} onPress={onOpenTrends} style={styles.trendEntryCard}>
      <View><Text style={styles.trendEntryKicker}>{mobileT("mobile.ui.productshell.d59aa2cd98")}</Text><Text style={styles.trendEntryTitle}>{mobileT("mobile.ui.productshell.f894dc3211")}</Text><Text style={styles.trendEntryMeta}>{mobileT("mobile.ui.productshell.ff7d1e628f")}</Text></View><Text style={styles.trendEntryArrow}>↗</Text>
    </Pressable>
  </>;
}

function BehaviorCard({ mark, title, value, meta }: { mark: string; title: string; value: string; meta: string }) {
  return <PanelCard style={styles.behaviorCard}><View style={styles.behaviorTop}><Text style={styles.behaviorMark}>{mark}</Text><Text style={styles.behaviorTitle}>{title}</Text></View><Text style={styles.behaviorValue}>{value}</Text><Text style={styles.behaviorMeta}>{meta}</Text></PanelCard>;
}

/** 周肌群复盘卡：相对负荷呈现，每条结论可展开到具体动作与确认组。 */
function MuscleWeekCard({ report }: { report: NonNullable<CoachProductProjection["plan"]["muscleWeek"]> }) {
  const [expanded, setExpanded] = useState<string>();
  const muscleLabel = (muscleId: string) => {
    const key = `mobile.muscle.${muscleId}`;
    const translated = mobileT(key);
    return translated === `[${key}]` ? muscleId : translated;
  };
  return <View style={styles.quickChoiceCard}>
    <Text style={styles.quickChoiceTitle}>{mobileT("mobile.muscleweek.title")}</Text>
    <Text style={styles.quickChoiceHint}>{mobileT("mobile.muscleweek.disclaimer")}</Text>
    {report.perMuscle.length === 0 ? <Text style={styles.quickChoiceHint}>{mobileT("mobile.muscleweek.empty")}</Text> : null}
    {report.perMuscle.map((row) => {
      const gapKey = `mobile.muscleweek.gap.${row.targetGap}` as const;
      const isOpen = expanded === row.muscleId;
      return <View key={row.muscleId} style={styles.muscleRow}>
        <Pressable accessibilityRole="button" accessibilityLabel={`${muscleLabel(row.muscleId)} ${mobileT("mobile.muscleweek.sources")}`} onPress={() => setExpanded(isOpen ? undefined : row.muscleId)} style={styles.muscleRowHeader}>
          <Text style={styles.muscleRowTitle}>{muscleLabel(row.muscleId)}</Text>
          <Text style={styles.muscleRowMeta}>{row.directSets} {mobileT("mobile.muscleweek.directSets")} · {mobileT(gapKey)}{row.synergistLoad > 0 ? ` · ${mobileT("mobile.muscleweek.synergistLoad")} ${row.synergistLoad}` : ""}</Text>
        </Pressable>
        {isOpen ? <View style={styles.muscleRowDetail}>
          {row.contributions.map((entry, index) => <Text key={`${entry.exerciseVariantId}-${entry.date}-${index}`} style={styles.muscleRowDetailText}>{entry.date.slice(5)} · {entry.exerciseName} · {entry.sets} {mobileT("mobile.muscleweek.sets")}{entry.role === "primary_intent" ? "" : `（${mobileT("mobile.muscleweek.synergistLoad")}）`}</Text>)}
        </View> : null}
      </View>;
    })}
    {report.unknownExercises.map((entry) => <Text key={entry.exerciseVariantId} style={styles.quickChoiceHint}>{entry.exerciseName} · {entry.sets} {mobileT("mobile.muscleweek.sets")} · {mobileT("mobile.muscleweek.unknownNotCounted")}</Text>)}
    {report.limitations.map((line) => <Text key={line} style={styles.muscleRowLimit}>{line}</Text>)}
  </View>;
}

function PlanTrends({ application, userId, screen, onUpdated }: { application: LocalProductKernel; userId: string; screen: CoachProductProjection; onUpdated(): void }) {  const [feedback, setFeedback] = useState("");
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [feedbackSaved, setFeedbackSaved] = useState(false);
  const weight = screen.progress.bodyTrends.weight[0];
  const bodyFat = screen.progress.bodyTrends.bodyFat[0];
  const weightPoints = weight?.smoothedPoints.map((point) => ({ label: point.date, value: point.smoothedValue ?? point.value })) ?? [];
  const bodyFatPoints = bodyFat?.smoothedPoints.map((point) => ({ label: point.date, value: point.smoothedValue ?? point.value })) ?? [];
  const composite = screen.progress.strengthTrends.composite;
  const health = screen.progress.healthTrends;
  const dailyEnergy = health.daily.flatMap((day) => day.energyBalance.status === "complete" ? [{ label: day.date, value: (day.energyBalance.range.min + day.energyBalance.range.max) / 2 }] : []);
  const weeklyEnergy = health.weekly.flatMap((bucket) => bucket.energyBalance ? [{ label: bucket.key, value: (bucket.energyBalance.min + bucket.energyBalance.max) / 2 }] : []);
  const monthlyEnergy = health.monthly.flatMap((bucket) => bucket.energyBalance ? [{ label: bucket.key, value: (bucket.energyBalance.min + bucket.energyBalance.max) / 2 }] : []);
  const dailyProtein = health.daily.flatMap((day) => day.nutrition.nutrients.protein.intakeKnown ? [{ label: day.date, value: day.nutrition.nutrients.protein.consumedLogged }] : []);
  const dailyFiber = health.daily.flatMap((day) => day.nutrition.nutrients.fiber.intakeKnown ? [{ label: day.date, value: day.nutrition.nutrients.fiber.consumedLogged }] : []);
  const dailySodium = health.daily.flatMap((day) => day.nutrition.nutrients.sodium.intakeKnown ? [{ label: day.date, value: day.nutrition.nutrients.sodium.consumedLogged }] : []);
  const dailyPotassium = health.daily.flatMap((day) => day.nutrition.nutrients.potassium.intakeKnown ? [{ label: day.date, value: day.nutrition.nutrients.potassium.consumedLogged }] : []);
  const dailyCalcium = health.daily.flatMap((day) => day.nutrition.nutrients.calcium.intakeKnown ? [{ label: day.date, value: day.nutrition.nutrients.calcium.consumedLogged }] : []);
  const dailyIron = health.daily.flatMap((day) => day.nutrition.nutrients.iron.intakeKnown ? [{ label: day.date, value: day.nutrition.nutrients.iron.consumedLogged }] : []);
  const dailyMagnesium = health.daily.flatMap((day) => day.nutrition.nutrients.magnesium.intakeKnown ? [{ label: day.date, value: day.nutrition.nutrients.magnesium.consumedLogged }] : []);
  const dailyVitaminC = health.daily.flatMap((day) => day.nutrition.nutrients.vitamin_c?.intakeKnown ? [{ label: day.date, value: day.nutrition.nutrients.vitamin_c.consumedLogged }] : []);
  const weeklyActivity = health.weekly.map((bucket) => ({ label: bucket.key, value: bucket.activityMinutes }));
  const weeklyTraining = health.weekly.map((bucket) => ({ label: bucket.key, value: bucket.trainingCompleted }));
  const weeklyRecovery = health.weekly.map((bucket) => ({ label: bucket.key, value: bucket.recoveryObservationCount }));
  const saveStageFeedback = async (burden: "acceptable" | "high") => {
    if (!screen.source.planId || !screen.plan.revision || !screen.plan.effectiveFrom) return;
    setFeedbackBusy(true);
    try {
      await application.recordPlanOutcome({
        userId,
        planId: screen.source.planId,
        planRevision: screen.plan.revision,
        observedFrom: screen.plan.effectiveFrom,
        observedThrough: screen.today.date,
        timezoneOffsetMinutes: new Date().getTimezoneOffset() * -1,
        burden,
        ...(feedback.trim() ? { feedback: feedback.trim() } : {}),
        preferenceSignals: [{
          behaviorId: `plan:${screen.source.planId}:revision:${screen.plan.revision}:stage_shape`,
          result: burden === "acceptable" ? "repeated_and_acceptable" : "avoided",
          source: "confirmed_behavior_and_feedback",
        }],
        idempotencyKey: `mobile-plan-feedback:${screen.source.planId}:${screen.plan.revision}:${Date.now().toString(36)}`,
      });
      setFeedbackSaved(true);
      onUpdated();
    } finally {
      setFeedbackBusy(false);
    }
  };
  return <>
    {screen.plan.status === "current" ? <View style={styles.quickChoiceCard}>
      <Text style={styles.quickChoiceTitle}>{mobileT("mobile.plan.feedback.title")}</Text>
      <Text style={styles.quickChoiceHint}>{mobileT("mobile.plan.feedback.hint")}</Text>
      <TextInput accessibilityLabel={mobileT("mobile.plan.feedback.label")} value={feedback} onChangeText={setFeedback} placeholder={mobileT("mobile.plan.feedback.placeholder")} placeholderTextColor={colors.ink3} style={styles.logInput} />
      <View style={styles.logQuickRow}>
        <Pressable accessibilityRole="button" disabled={feedbackBusy} onPress={() => void saveStageFeedback("acceptable")} style={styles.logQuick}><Text style={styles.logQuickText}>{mobileT("mobile.plan.feedback.acceptable")}</Text></Pressable>
        <Pressable accessibilityRole="button" disabled={feedbackBusy} onPress={() => void saveStageFeedback("high")} style={styles.logQuick}><Text style={styles.logQuickText}>{mobileT("mobile.plan.feedback.high")}</Text></Pressable>
      </View>
      {feedbackSaved ? <Text style={styles.quickChoiceHint}>{mobileT("mobile.plan.feedback.saved")}</Text> : null}
    </View> : null}
    {screen.plan.muscleWeek ? <MuscleWeekCard report={screen.plan.muscleWeek} /> : null}
    <SectionHeading title={mobileT("mobile.trends.energyNutrition")} meta={health.calibration.status === "calibrated" ? mobileT("mobile.trends.maintenanceRange", { min: health.calibration.maintenanceRange?.min ?? "—", max: health.calibration.maintenanceRange?.max ?? "—" }) : mobileT("mobile.trends.calibrating")} />
    <TrendChart title={mobileT("mobile.trends.dailyEnergy")} value={dailyEnergy.length ? `${Math.round(dailyEnergy.at(-1)!.value)} kcal` : "—"} meta={mobileT("mobile.trends.completeDaysOnly")} points={dailyEnergy} color={uiColors.amber} />
    <TrendChart title={mobileT("mobile.trends.weeklyEnergy")} value={weeklyEnergy.length ? `${Math.round(weeklyEnergy.at(-1)!.value)} kcal` : "—"} meta={mobileT("mobile.trends.weeklySummary")} points={weeklyEnergy} color={uiColors.safe} />
    <TrendChart title={mobileT("mobile.trends.monthlyEnergy")} value={monthlyEnergy.length ? `${Math.round(monthlyEnergy.at(-1)!.value)} kcal` : "—"} meta={mobileT("mobile.trends.monthlySummary")} points={monthlyEnergy} />
    <TrendChart title={mobileT("mobile.trends.dailyNutrient", { nutrient: mobileT("mobile.ui.productshell.fcf373f67b") })} value={dailyProtein.length ? `${Math.round(dailyProtein.at(-1)!.value)} g` : "—"} meta={mobileT("mobile.trends.confirmedCompleteDays")} points={dailyProtein} color={uiColors.safe} />
    <TrendChart title={mobileT("mobile.trends.dailyNutrient", { nutrient: mobileT("mobile.nutrient.fiber") })} value={dailyFiber.length ? `${Math.round(dailyFiber.at(-1)!.value)} g` : "—"} meta={mobileT("mobile.trends.confirmedCompleteDays")} points={dailyFiber} />
    <TrendChart title={mobileT("mobile.trends.dailyNutrient", { nutrient: mobileT("mobile.nutrient.sodium") })} value={dailySodium.length ? `${Math.round(dailySodium.at(-1)!.value)} mg` : "—"} meta={mobileT("mobile.trends.confirmedCompleteDays")} points={dailySodium} color={uiColors.amber} />
    <TrendChart title={mobileT("mobile.trends.dailyNutrient", { nutrient: mobileT("mobile.nutrient.potassium") })} value={dailyPotassium.length ? `${Math.round(dailyPotassium.at(-1)!.value)} mg` : "—"} meta={mobileT("mobile.trends.confirmedCompleteDays")} points={dailyPotassium} />
    <TrendChart title={mobileT("mobile.trends.dailyNutrient", { nutrient: mobileT("mobile.nutrient.calcium") })} value={dailyCalcium.length ? `${Math.round(dailyCalcium.at(-1)!.value)} mg` : "—"} meta={mobileT("mobile.trends.confirmedCompleteDays")} points={dailyCalcium} />
    <TrendChart title={mobileT("mobile.trends.dailyNutrient", { nutrient: mobileT("mobile.nutrient.iron") })} value={dailyIron.length ? `${Math.round(dailyIron.at(-1)!.value)} mg` : "—"} meta={mobileT("mobile.trends.confirmedCompleteDays")} points={dailyIron} />
    <TrendChart title={mobileT("mobile.trends.dailyNutrient", { nutrient: mobileT("mobile.nutrient.magnesium") })} value={dailyMagnesium.length ? `${Math.round(dailyMagnesium.at(-1)!.value)} mg` : "—"} meta={mobileT("mobile.trends.confirmedCompleteDays")} points={dailyMagnesium} />
    <TrendChart title={mobileT("mobile.trends.dailyNutrient", { nutrient: mobileT("mobile.nutrient.vitaminC") })} value={dailyVitaminC.length ? `${Math.round(dailyVitaminC.at(-1)!.value)} mg` : "—"} meta={mobileT("mobile.trends.confirmedCompleteDays")} points={dailyVitaminC} />
    <SectionHeading title={mobileT("mobile.trends.activityTrainingRecovery")} meta={mobileT("mobile.trends.missingNotFailure")} />
    <TrendChart title={mobileT("mobile.trends.weeklyActivity")} value={weeklyActivity.length ? `${Math.round(weeklyActivity.at(-1)!.value)} min` : "—"} meta={mobileT("mobile.trends.confirmedActivity")} points={weeklyActivity} />
    <TrendChart title={mobileT("mobile.trends.weeklyTraining")} value={weeklyTraining.length ? `${Math.round(weeklyTraining.at(-1)!.value)} 次` : "—"} meta={mobileT("mobile.trends.confirmedCompletion")} points={weeklyTraining} color={uiColors.safe} />
    <TrendChart title={mobileT("mobile.trends.weeklyRecovery")} value={weeklyRecovery.length ? `${Math.round(weeklyRecovery.at(-1)!.value)} 次` : "—"} meta={mobileT("mobile.trends.sleepRecovery")} points={weeklyRecovery} color={uiColors.amber} />
    <SectionHeading title={mobileT("mobile.ui.productshell.f27012ee66")} meta={mobileT("mobile.ui.productshell.021d6ca577")} />
    <TrendChart title={mobileT("mobile.ui.productshell.3193595c29")} value={trendValue(weight?.smoothedPoints.at(-1)?.smoothedValue, weight?.rawPoints.at(-1)?.unit)} meta={trendCoverage(weight?.coverage.observations)} points={weightPoints} />
    <TrendChart title={mobileT("mobile.ui.productshell.338f5241cc")} value={trendValue(bodyFat?.smoothedPoints.at(-1)?.smoothedValue, bodyFat?.rawPoints.at(-1)?.unit)} meta={trendCoverage(bodyFat?.coverage.observations)} points={bodyFatPoints} color={uiColors.amber} />

    <SectionHeading title={mobileT("mobile.ui.productshell.221f52190d")} meta={mobileT("mobile.ui.productshell.1217d9972c")} />
    {screen.progress.strengthTrends.lifts.map((lift) => <TrendChart key={lift.id} title={lift.label} value={lift.latestKg === undefined ? "—" : `${lift.latestKg} kg`} meta={lift.changePercent === undefined ? mobileT("mobile.ui.productshell.82e0f825d6") : mobileT("mobile.ui.productshell.299b7fac2a", { value0: lift.changePercent >= 0 ? "+" : "", value1: lift.changePercent })} points={lift.points.map((point) => ({ label: point.date, value: point.valueKg }))} />)}
    <TrendChart title={mobileT("mobile.ui.productshell.bdd5b6918b")} value={composite.length ? `${composite.at(-1)!.index}` : "—"} meta={mobileT("mobile.ui.productshell.4d33e41013")} points={composite.map((point) => ({ label: point.date, value: point.index }))} color={uiColors.safe} />

    <SectionHeading title={mobileT("mobile.ui.productshell.71b9018159")} meta={mobileT("mobile.ui.productshell.4609781aac")} />
    <View style={styles.metricDecisionCard}>{screen.progress.metrics.map((metric, index) => <MetricDecisionRow key={metric.name} metric={metric} index={index + 1} />)}</View>
    <SectionHeading title={mobileT("mobile.ui.productshell.6833cf1b3b")} meta={screen.progress.reportArtifacts.length ? mobileT("mobile.ui.productshell.85851356c7", { value0: screen.progress.reportArtifacts.length }) : mobileT("mobile.ui.productshell.6da8b19d8b")} />
    {screen.progress.reportArtifacts.length ? screen.progress.reportArtifacts.map((artifact) => <View key={artifact.id} style={styles.reportRow}><Text style={styles.reportTitle}>{artifact.kind === "weekly_coach_report" ? mobileT("mobile.ui.productshell.19e222d00d") : mobileT("mobile.ui.productshell.c7420676ff")}</Text><Text style={styles.reportMeta}>{artifact.createdAt.slice(0, 10)}</Text></View>) : <Empty label={mobileT("mobile.ui.productshell.667bb8d8b3")} />}
  </>;
}

function TrainingPlanTab({ plan, locale }: { plan: CoachProductProjection["plan"]; locale?: string }) {
  const currentTraining = plan.currentWeek.filter((session) => session.kind !== "rest" && session.kind !== "recovery" && session.taskCount > 0);
  const currentSets = currentTraining
    .filter((session) => session.kind === "weighted_reps" || session.kind === "bodyweight_reps")
    .reduce((sum, session) => sum + session.totalSetCount, 0);
  return <>
    {plan.strategySelection ? <View style={styles.committedPlanHero}>
      <View style={styles.reportCoverTop}><Text style={styles.reportKicker}>{mobileT("mobile.plan.activeRevision", { revision: plan.revision ?? 0 })}</Text><View style={styles.reportStatus}><View style={styles.reportStatusDot} /><Text style={styles.reportStatusText}>{mobileT("mobile.ui.productshell.1f425b6bf0")}</Text></View></View>
      <Text style={styles.reportCoverLabel}>{mobileT("mobile.ui.productshell.6674bef13e")}</Text>
      <Text style={styles.reportCoverTitle}>{strategyName(plan.strategySelection.primary, locale)}</Text>
      <Text style={styles.reportCoverCopy}>{planningPhrase(plan.appliedPhaseStrategy?.objective ?? "progress_with_recovery_budget", locale)}</Text>
      <View style={styles.reportMetricGrid}><ReportMetric value={mobileT("mobile.ui.productshell.a9cc46ba8b", { value0: currentTraining.length })} label={mobileT("mobile.ui.productshell.479d143315")} /><ReportMetric value={mobileT("mobile.ui.productshell.47040f073f", { value0: currentSets })} label={mobileT("mobile.ui.productshell.1fcfb573d2")} /><ReportMetric value={plan.appliedPhaseStrategy ? shortDate(plan.appliedPhaseStrategy.reviewAt) : mobileT("mobile.ui.productshell.a93b55d8bf")} label={mobileT("mobile.ui.productshell.c0ddc03b4c")} /></View>
    </View> : null}

    <ReportSectionHeading index="01" title={mobileT("mobile.ui.productshell.479d143315")} subtitle={mobileT("mobile.ui.productshell.96805b8574")} />
    {plan.currentWeek.map((session) => <DetailedPlanSession key={session.id} session={session} />)}

    <ReportSectionHeading index="02" title={mobileT("mobile.ui.productshell.f17a51e144")} subtitle={mobileT("mobile.ui.productshell.53c97464cb")} />
    <View style={styles.strategyStack}>
      <StrategyReportCard mark="T" title={mobileT("mobile.ui.productshell.a23c7ae9c9")} copy={planningPhrase(plan.trainingStrategy?.progression[0] ?? "compare_exact_variant_history_when_available", locale)} />
      <StrategyReportCard mark="R" title={mobileT("mobile.ui.productshell.29990e9c51")} copy={planningPhrase(plan.recoveryStrategy?.objective ?? "keep_daily_variation inside a safe next-session boundary", locale)} />
    </View>
    {plan.explanation ? <View style={styles.reportEvidenceCard}>{plan.explanation.userEvidence.map((item) => <ReportBullet key={item} text={planningPhrase(item, locale)} />)}{plan.explanation.ruleReason.map((item) => <ReportBullet key={item} text={planningPhrase(item, locale)} />)}{plan.explanation.uncertainty.map((item) => <ReportBullet key={item} text={planningPhrase(item, locale)} tone="unknown" />)}</View> : null}

    {plan.forecasts.length ? <><ReportSectionHeading index="03" title={mobileT("mobile.ui.productshell.efb1fd2fd9")} subtitle={mobileT("mobile.ui.productshell.03e9fdc03a")} /><View style={styles.forecastStack}>{plan.forecasts.map((forecast) => <View key={forecast.scenario} style={[styles.forecastReportCard, forecast.scenario === "balanced" && styles.forecastReportCardRecommended]}><View style={styles.forecastReportTop}><View><Text style={styles.forecastReportTitle}>{forecastName(forecast.scenario, locale)}</Text><Text style={styles.forecastReportEligibility}>{forecastEligibility(forecast.eligibility, locale)}</Text></View>{forecast.scenario === "balanced" ? <Text style={styles.forecastRecommended}>{mobileT("mobile.ui.productshell.62b46f24ae")}</Text> : null}</View><Text style={styles.forecastReportDate}>{shortDate(forecast.earliest)}—{shortDate(forecast.latest)}</Text><Text style={styles.forecastReportMeta}>{mobileT("mobile.ui.productshell.a606583b54")}{forecast.tradeoffs.map((value) => planningPhrase(value, locale)).join("；")}</Text></View>)}</View></> : null}

    {plan.nextWeek.length ? <><ReportSectionHeading index="04" title={mobileT("mobile.ui.productshell.14e97cc11e")} subtitle={mobileT("mobile.ui.productshell.8b39aa6f3d")} />{plan.nextWeek.map((session) => <DetailedPlanSession key={session.id} session={session} subdued />)}</> : null}
    {plan.futureIntentCount ? <Text style={styles.planFootnote}>{mobileT("mobile.ui.productshell.068c69578d")}{plan.futureIntentCount} {mobileT("mobile.ui.productshell.b1106ec793")}</Text> : null}
  </>;
}

function IntakePlanTab({ screen, onRecordMeal }: { screen: CoachProductProjection; onRecordMeal: () => void }) {
  const plan = screen.plan;
  const todayBudget = plan.intakeWeek.find((budget) => budget.date === screen.today.date) ?? screen.today.nutrition.healthLedger;
  const palette = intakePalette(ledgerIntakeStatus(todayBudget));
  const explanation = intakeExplanation(todayBudget);
  const nutritionProtein = plan.nutritionTarget?.macronutrientTargets?.proteinGrams;
  const knownTargetDays = plan.intakeWeek.filter((budget) => ledgerTargetKcal(budget) !== undefined);
  const weeklyTarget = knownTargetDays.length === plan.intakeWeek.length
    ? knownTargetDays.reduce((sum, budget) => sum + (ledgerTargetKcal(budget) ?? 0), 0)
    : undefined;
  return <>
    <View style={styles.intakePlanHero}>
      <View style={styles.intakePlanHeroTop}>
        <View><Text style={[styles.cardEyebrow, styles.intakeEyebrow]}>{mobileT("mobile.date.todayShort", { date: shortDate(todayBudget.date) })}</Text><Text style={styles.intakePlanHeroTitle}>{mobileT("mobile.ui.productshell.ecd65f09e3")}</Text></View>
        <View style={[styles.intakeStatusChip, { backgroundColor: palette.soft }]}><View style={[styles.intakeStatusDot, { backgroundColor: palette.color }]} /><Text style={[styles.intakeStatusChipText, { color: palette.ink }]}>{intakeStatusLabel(todayBudget)}</Text></View>
      </View>
      <View style={styles.intakePlanHeroMain}>
        <DailyFuelRing ledger={todayBudget} size={154} />
        <View style={styles.intakePlanHeroNumbers}>
          <Text style={styles.intakeDayLabel}>{nutritionDayKindLabel(todayBudget.nutritionPlan.dayKind)}{mobileT("mobile.ui.productshell.c5134eb19c")}</Text>
          <Text style={styles.intakePlanTarget}>{ledgerTargetKcal(todayBudget)?.toLocaleString() ?? "—"}</Text>
          <Text style={styles.intakeTargetUnit}>kcal</Text>
          <Text style={styles.intakeTargetRange}>{todayBudget.nutritionPlan.targets.energy.range ? mobileT("mobile.ui.productshell.fc3455c55e", { value0: todayBudget.nutritionPlan.targets.energy.range.min.toLocaleString(), value1: todayBudget.nutritionPlan.targets.energy.range.max.toLocaleString() }) : mobileT("mobile.ui.productshell.02599b3712")}</Text>
        </View>
      </View>
      <View style={[styles.intakeExplanation, { backgroundColor: palette.soft, borderLeftColor: palette.color }]}><Text style={[styles.intakeExplanationTitle, { color: palette.ink }]}>{explanation.title}</Text><Text style={styles.intakeExplanationBody}>{explanation.body}</Text></View>
      <Pressable accessibilityRole="button" onPress={onRecordMeal} style={styles.intakePlanPrimary}><Text style={styles.intakePlanPrimaryText}>{mobileT("mobile.ui.productshell.0df4b00a18")}</Text><View style={styles.intakePlanPrimaryArrow}><Text style={styles.intakePlanPrimaryArrowText}>＋</Text></View></Pressable>
    </View>

    <ReportSectionHeading index="01" title={mobileT("mobile.ui.productshell.bd32e8e4f0")} subtitle={weeklyTarget === undefined ? mobileT("mobile.ui.productshell.7260141f34") : mobileT("mobile.ui.productshell.0748298d55", { value0: weeklyTarget.toLocaleString() })} />
    <View style={styles.intakeWeekCard}>
      {plan.intakeWeek.map((budget) => <IntakeWeekRow key={budget.date} budget={budget} current={budget.date === screen.today.date} />)}
    </View>

    <ReportSectionHeading index="02" title={mobileT("mobile.ui.productshell.7cc538b9d1")} subtitle={mobileT("mobile.ui.productshell.b037f18a59")} />
    <View style={styles.intakeBreakdownCard}>
      <IntakeBreakdownRow label={mobileT("mobile.ui.productshell.5b8a81be18")} detail={plan.nutritionTarget?.confidence === "provisional" ? mobileT("mobile.ui.productshell.5474b622cd") : mobileT("mobile.ui.productshell.0d66b08d45")} value={ledgerTargetKcal(todayBudget) === undefined ? mobileT("mobile.ui.productshell.901f4139cc") : `${ledgerTargetKcal(todayBudget)!.toLocaleString()} kcal`} />
      <IntakeBreakdownRow label={nutritionDayKindLabel(todayBudget.nutritionPlan.dayKind)} detail={mobileT("mobile.ui.productshell.4bea0b67a5")} value={todayBudget.nutritionPlan.targets.energy.range ? `${todayBudget.nutritionPlan.targets.energy.range.min.toLocaleString()}–${todayBudget.nutritionPlan.targets.energy.range.max.toLocaleString()} kcal` : "—"} />
      <IntakeBreakdownRow label={mobileT("mobile.ui.productshell.58630bc131")} detail={mobileT("mobile.ui.productshell.59bf22812e")} value={todayBudget.expenditure.total.range ? `${todayBudget.expenditure.total.range.min.toLocaleString()}–${todayBudget.expenditure.total.range.max.toLocaleString()} kcal` : "—"} />
      <View style={styles.intakeBreakdownTotal}><Text style={styles.intakeBreakdownTotalLabel}>{mobileT("mobile.ui.productshell.d93d0ed8bb")}</Text><Text style={styles.intakeBreakdownTotalValue}>{todayBudget.energyBalance.status === "complete" ? signedKcal(Math.round((todayBudget.energyBalance.range.min + todayBudget.energyBalance.range.max) / 2)) : "—"}</Text></View>
    </View>

    <ReportSectionHeading index="03" title={mobileT("mobile.ui.productshell.450e92a0b1")} subtitle={mobileT("mobile.ui.productshell.f008567c2a")} />
    <View style={styles.nutritionPrincipleCard}>
      <View style={styles.nutritionPrincipleLead}><Text style={styles.nutritionPrincipleValue}>{nutritionProtein ? `${nutritionProtein.min}–${nutritionProtein.max} g` : mobileT("mobile.ui.productshell.a24a2c55f7")}</Text><Text style={styles.nutritionPrincipleLabel}>{mobileT("mobile.ui.productshell.417440321b")}</Text></View>
      <View style={styles.intakeSteps}>
        <IntakeStep index="1" title={mobileT("mobile.ui.productshell.70a1677746")} detail={nutritionProtein ? mobileT("mobile.ui.productshell.6310cf75e6", { value0: nutritionProtein.min, value1: nutritionProtein.max }) : mobileT("mobile.ui.productshell.92abb26d88")} />
        <IntakeStep index="2" title={mobileT("mobile.ui.productshell.ae60c5ab17")} detail={mobileT("mobile.ui.productshell.d6c64e25ae")} />
        <IntakeStep index="3" title={mobileT("mobile.ui.productshell.c5be261dc3")} detail={mobileT("mobile.ui.productshell.906647cfc4")} />
      </View>
      <Text style={styles.reportBoundary}>{mobileT("mobile.ui.productshell.6bdc3f0bc0")}</Text>
    </View>
  </>;
}

function IntakeWeekRow({ budget, current }: { budget: DailyHealthLedger; current: boolean }) {
  const palette = intakePalette(ledgerIntakeStatus(budget));
  const progress = clampNumber(ledgerProgressRatio(budget) ?? 0, 0, 1);
  return <View style={[styles.intakeWeekRow, current && styles.intakeWeekRowCurrent]}>
    <View style={[styles.intakeWeekDay, current && styles.intakeWeekDayCurrent]}><Text style={[styles.intakeWeekDayName, current && styles.intakeWeekDayNameCurrent]}>{current ? mobileT("mobile.ui.productshell.17e83cc25e") : weekDayLabel(budget.date)}</Text><Text style={[styles.intakeWeekDate, current && styles.intakeWeekDateCurrent]}>{budget.date.slice(5).replace("-", "/")}</Text></View>
    <View style={styles.intakeWeekBody}>
      <View style={styles.intakeWeekTop}><Text style={styles.intakeWeekKind}>{nutritionDayKindLabel(budget.nutritionPlan.dayKind)}</Text><Text style={styles.intakeWeekTarget}>{ledgerTargetKcal(budget) === undefined ? mobileT("mobile.ui.productshell.901f4139cc") : `${ledgerTargetKcal(budget)!.toLocaleString()} kcal`}</Text></View>
      <View style={styles.intakeWeekProgress}><View style={[styles.intakeWeekProgressFill, { backgroundColor: palette.color, flex: progress }]} /><View style={{ flex: Math.max(0.001, 1 - progress) }} /></View>
      <View style={styles.intakeWeekBottom}><Text style={styles.intakeWeekConsumed}>{ledgerConsumedKcal(budget) === undefined ? mobileT("mobile.ui.productshell.8848fd08e1") : mobileT("mobile.ui.productshell.a73e2bf080", { value0: ledgerConsumedKcal(budget)!.toLocaleString() })}</Text><Text style={[styles.intakeWeekStatus, { color: palette.ink }]}>{intakeStatusLabel(budget)}</Text></View>
    </View>
  </View>;
}

function IntakeBreakdownRow({ label, detail, value, tone = "neutral" }: { label: string; detail: string; value: string; tone?: "positive" | "neutral" }) {
  return <View style={styles.intakeBreakdownRow}><View style={styles.intakeBreakdownBody}><Text style={styles.intakeBreakdownLabel}>{label}</Text><Text style={styles.intakeBreakdownDetail}>{detail}</Text></View><Text style={[styles.intakeBreakdownValue, tone === "positive" && styles.intakeBreakdownValuePositive]}>{value}</Text></View>;
}

const movementChoices: readonly { value: MovementPattern; label: string }[] = [
  { value: "horizontal_push", label: mobileT("mobile.ui.productshell.39cf667cf6") },
  { value: "vertical_push", label: mobileT("mobile.ui.productshell.278584dc5c") },
  { value: "horizontal_pull", label: mobileT("mobile.ui.productshell.86a96eb16d") },
  { value: "vertical_pull", label: mobileT("mobile.ui.productshell.73a7b538ab") },
  { value: "squat", label: mobileT("mobile.ui.productshell.892fd5fbd9") },
  { value: "hip_hinge", label: mobileT("mobile.ui.productshell.3459617d92") },
  { value: "lunge", label: mobileT("mobile.ui.productshell.67b8955983") },
  { value: "core_anti_extension", label: mobileT("mobile.ui.productshell.10d95f2cd2") },
  { value: "locomotion", label: mobileT("mobile.ui.productshell.591f3aa55f") },
];

function ExerciseManager({ application, userId, onDismiss }: { application: LocalProductKernel; userId: string; onDismiss: () => void }) {
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
      setError(userFacingError(cause, mobileT("mobile.ui.productshell.dce066e541")));
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
      setError(mobileT("mobile.ui.productshell.14c52fdc88"));
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
      setError(userFacingError(cause, mobileT("mobile.ui.productshell.45dcc45100")));
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
      setError(userFacingError(cause, mobileT("mobile.ui.productshell.411efc0d21")));
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
          <View style={styles.exerciseManagerHeaderCopy}><Text style={styles.logTitle}>{mobileT("mobile.ui.productshell.00a7fb031f")}</Text><Text style={styles.exerciseManagerSub}>{mobileT("mobile.ui.productshell.753c0cd0f7")}</Text></View>
          <Pressable accessibilityRole="button" accessibilityLabel={mobileT("mobile.ui.productshell.85eddb7f77")} onPress={onDismiss} style={styles.exerciseClose}><Text style={styles.exerciseCloseText}>{mobileT("mobile.ui.productshell.33246f6a5e")}</Text></Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.exerciseManagerScroll} keyboardShouldPersistTaps="handled">
          {exercises === undefined ? <ActivityIndicator color={colors.limeDeep} /> : exercises.length ? exercises.map((exercise) => (
            <View key={exercise.id} style={styles.exerciseRow}>
              <View style={styles.exerciseRowBody}><Text style={styles.exerciseRowTitle}>{exercise.name}</Text><Text style={styles.exerciseRowMeta}>{movementLabel(exercise.movement)} · {exercise.prescriptionMode === "bodyweight_reps" ? mobileT("mobile.ui.productshell.8ccfa9ce7a") : exercise.prescriptionMode === "timed" ? mobileT("mobile.ui.productshell.3cacefc6aa") : mobileT("mobile.ui.productshell.f0c21c3440")}</Text></View>
              <Pressable accessibilityRole="button" accessibilityLabel={mobileT("mobile.ui.productshell.f872afc332", { value0: exercise.name })} disabled={busy} onPress={() => startEdit(exercise)} style={styles.exerciseInlineButton}><Text style={styles.exerciseInlineText}>{mobileT("mobile.ui.productshell.a7f814c0a4")}</Text></Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel={mobileT("mobile.ui.productshell.57a816ba3d", { value0: exercise.name })} disabled={busy} onPress={() => void archive(exercise)} style={styles.exerciseInlineButton}><Text style={styles.exerciseArchiveText}>{mobileT("mobile.ui.productshell.ddfde75bec")}</Text></Pressable>
            </View>
          )) : <Text style={styles.exerciseEmpty}>{mobileT("mobile.ui.productshell.ef3db68a70")}</Text>}
          <View style={styles.exerciseForm}>
            <Text style={styles.exerciseFormTitle}>{editing ? mobileT("mobile.ui.productshell.f64bb060a4") : mobileT("mobile.ui.productshell.f05fa8682c")}</Text>
            <TextInput accessibilityLabel={mobileT("mobile.ui.productshell.7bfa73f408")} value={name} onChangeText={setName} style={styles.logInput} placeholder={mobileT("mobile.ui.productshell.9009cf6bfe")} placeholderTextColor="#777971" />
            <Text style={styles.exerciseFieldLabel}>{mobileT("mobile.ui.productshell.1df775c291")}</Text>
            <View style={styles.logQuickRow}>{movementChoices.map((choice) => <Pressable key={choice.value} accessibilityRole="radio" accessibilityState={{ selected: movement === choice.value }} onPress={() => setMovement((current) => current === choice.value ? undefined : choice.value)} style={[styles.logQuick, movement === choice.value && styles.logQuickSelected]}><Text style={[styles.logQuickText, movement === choice.value && styles.logQuickTextSelected]}>{choice.label}</Text></Pressable>)}</View>
            {error ? <Text style={styles.formError}>{error}</Text> : null}
            <View style={styles.exerciseFormActions}>
              {editing ? <Pressable accessibilityRole="button" disabled={busy} onPress={resetForm} style={styles.exerciseCancel}><Text style={styles.exerciseCancelText}>{mobileT("mobile.ui.productshell.4d0b4688c7")}</Text></Pressable> : null}
              <Pressable accessibilityRole="button" disabled={busy} onPress={() => void save()} style={[styles.logSave, styles.exerciseSave, busy && styles.primaryButtonDisabled]}><Text style={styles.logSaveText}>{busy ? mobileT("mobile.ui.productshell.15127c2c4f") : editing ? mobileT("mobile.ui.productshell.60b4ae9082") : mobileT("mobile.ui.productshell.f05fa8682c")}</Text></Pressable>
            </View>
          </View>
        </ScrollView>
      </View>
    </View>
  );
}

function MetricDecisionRow({ metric, index }: { metric: CoachProductProjection["progress"]["metrics"][number]; index: number }) {
  const color = metric.value.direction === "improving" ? colors.fuelSafe : metric.value.direction === "declining" ? colors.fuelDanger : metric.value.direction === "stable" ? colors.ink : colors.ink3;
  const score = metric.value.score === undefined ? 0 : clampNumber(Math.abs(metric.value.score), 0, 1);
  return <View style={styles.metricDecisionRow}>
    <Text style={styles.metricDecisionIndex}>{String(index).padStart(2, "0")}</Text>
    <View style={styles.metricDecisionBody}>
      <View style={styles.metricDecisionTop}><Text style={styles.metricDecisionTitle}>{metricLabel(metric.name)}</Text><Text style={[styles.metricDecisionValue, { color }]}>{metricDirectionLabel(metric.value.direction)}</Text></View>
      <View style={styles.metricDecisionRail}><View style={[styles.metricDecisionFill, { backgroundColor: color, flex: Math.max(0.02, score) }]} /><View style={{ flex: Math.max(0.001, 1 - Math.max(0.02, score)) }} /></View>
      <Text style={styles.metricDecisionMeta}>{metricConfidenceLabel(metric.confidence)} · {metric.comparableDays} {mobileT("mobile.ui.productshell.72b3928d01")}</Text>
    </View>
  </View>;
}

function ProfileScreen({ application, userId, screen, onOpenAccountSettings, onUpdated }: { application: LocalProductKernel; userId: string; screen: CoachProductProjection; onOpenAccountSettings?: () => void; onUpdated: () => void }) {
  const profile = screen.profile;
  const [showPermissions, setShowPermissions] = useState(false);
  const [showPrivacyDetails, setShowPrivacyDetails] = useState(false);
  const [showActionLog, setShowActionLog] = useState(false);
  const [showCoachMemory, setShowCoachMemory] = useState(false);
  return (
    <ScrollView contentContainerStyle={[styles.content, styles.dockContent, styles.profileContent]} showsVerticalScrollIndicator={false}>
      {!profile.profileReady ? <View style={styles.profileStart}><Text style={styles.profileStartText}>{mobileT("mobile.conversation.profile.missing")}</Text></View> : null}
      {profile.profileReady ? <View style={styles.profileHero}>
        <View style={styles.profileHeroTop}><Text style={styles.profileHeroKicker}>{mobileT("mobile.ui.productshell.b0734a570c")}</Text><Text style={styles.profileHeroStatus}>{mobileT("mobile.ui.productshell.6809a9dd02")}</Text></View>
        <Text style={styles.profileHeroLabel}>{mobileT("mobile.ui.productshell.0679103486")}</Text><Text style={styles.profileHeroTitle}>{goalLabel(profile.primaryGoal)}</Text>
        <Text style={styles.profileHeroMeta}>{coachingModeLabel(profile.mandateMode)}</Text>
        <View style={styles.profileHeroStats}><View style={styles.profileHeroStat}><Text style={styles.profileHeroStatValue}>{profile.locations}</Text><Text style={styles.profileHeroStatLabel}>{mobileT("mobile.ui.productshell.972a3e3b17")}</Text></View><View style={styles.profileHeroStat}><Text style={styles.profileHeroStatValue}>{profile.customExercises}</Text><Text style={styles.profileHeroStatLabel}>{mobileT("mobile.ui.productshell.34032efb9c")}</Text></View></View>
      </View> : null}
      <Text style={styles.sectionTitle}>{mobileT("mobile.ui.productshell.dc9f2a12e0")}</Text>
      <CoachMemoryPanel application={application} userId={userId} onOpen={() => setShowCoachMemory(true)} />
      <Text style={styles.sectionTitle}>{mobileT("mobile.ui.productshell.560165a6d7")}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={mobileT("mobile.ui.productshell.d80f804e89")} onPress={() => setShowPermissions(true)} style={[styles.profileCard, !profile.permissions && !profile.planAuthorization && styles.profileSingleLineCard]}>
        {profile.permissions || profile.planAuthorization ? (
          <>
            {profile.permissions ? <ProfileRow label={mobileT("mobile.ui.productshell.0cd894e993")} value={permissionLabel(profile.permissions.health)} /> : null}
            {profile.permissions ? <ProfileRow label={mobileT("mobile.ui.productshell.7a66c0d036")} value={permissionLabel(profile.permissions.notifications)} /> : null}
            {profile.planAuthorization ? <ProfileRow label={mobileT("mobile.profile.planAuthorization.title")} value={planAuthorizationLabel(profile.planAuthorization.mandate.planChangeAuthorization)} /> : null}
          </>
        ) : <Text style={styles.emptyText}>{mobileT("mobile.ui.productshell.c6decd12ea")}</Text>}
      </Pressable>
      <Text style={styles.sectionTitle}>{mobileT("mobile.ui.productshell.3ea651f16f")}</Text>
      <PrivacySettingsPanel
        application={application}
        userId={userId}
        refreshKey={profile.permissions?.revision ?? 0}
        onOpenDetails={() => setShowPrivacyDetails(true)}
      />
      {onOpenAccountSettings ? <Pressable accessibilityRole="button" accessibilityLabel={mobileT("mobile.ui.productshell.b2686551cb")} onPress={onOpenAccountSettings} style={styles.profileLinkCard}><View><Text style={styles.profileLinkTitle}>{mobileT("mobile.ui.productshell.3c64034000")}</Text><Text style={styles.profileLinkMeta}>{mobileT("mobile.ui.productshell.372997171d")}</Text></View><Text style={styles.profileLinkArrow}>›</Text></Pressable> : null}
      <Text style={styles.sectionTitle}>{mobileT("mobile.ui.productshell.0cd894e993")}</Text>
      <HealthConnectionPanel application={application} userId={userId} permissions={profile.permissions} sources={profile.healthSources} onUpdated={onUpdated} />
      <Text style={styles.sectionTitle}>{mobileT("mobile.ui.productshell.c430bdb19d")}</Text>
      <RecipeReminderSettings application={application} userId={userId} onUpdated={onUpdated} />
      <Text style={styles.sectionTitle}>{mobileT("mobile.profile.secondaryTools.title")}</Text>
      {profile.actionLog.recent.length ? <>
        <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>{mobileT("mobile.ui.productshell.752398909f")}</Text><Pressable accessibilityRole="button" accessibilityLabel={mobileT("mobile.ui.productshell.2c6cdd6fdc")} onPress={() => setShowActionLog(true)}><Text style={styles.sectionLink}>{mobileT("mobile.ui.productshell.ed2172fd78")}</Text></Pressable></View>
        <View style={[styles.profileCard, styles.actionLogCard]}>
          {profile.actionLog.recent.map((entry, index) => <View key={entry.id} style={[styles.actionLogRow, index === profile.actionLog.recent.length - 1 && styles.actionLogRowLast]}><View style={styles.actionLogBody}><Text style={styles.actionLogTitle}>{actionLabel(entry.action)}</Text><Text style={styles.actionLogMeta}>{entry.actor === "agent" ? "Coach" : entry.actor === "rule_engine" ? mobileT("mobile.ui.productshell.fe3f473ffc") : mobileT("mobile.ui.productshell.5630b886f9")} · {actionResultLabel(entry.result)} · {entry.occurredAt.slice(5, 16)}</Text></View></View>)}
        </View>
      </> : null}
      {showPermissions && (profile.permissions || profile.planAuthorization) ? <PermissionSettings application={application} userId={userId} permissions={profile.permissions} planAuthorization={profile.planAuthorization} onDismiss={() => setShowPermissions(false)} onUpdated={() => { setShowPermissions(false); onUpdated(); }} /> : null}
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

type PrivacySettingsOverviewValue = Awaited<ReturnType<LocalProductKernel["readPrivacySettingsOverview"]>>;

/** A compact status card; the full disclosure deliberately lives behind a tap. */
function PrivacySettingsPanel({ application, userId, refreshKey, onOpenDetails }: {
  application: LocalProductKernel;
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
      if (active) setError(mobileT("mobile.ui.productshell.bb11f8db1e"));
    });
    return () => { active = false; };
  }, [application, refreshKey, userId]);
  if (!overview && !error) return <View style={[styles.profileCard, styles.privacySummaryLoading]}><ActivityIndicator color={colors.limeDeep} /></View>;
  if (error || !overview) return <Pressable accessibilityRole="button" accessibilityLabel={mobileT("mobile.ui.productshell.e721e00e3a")} onPress={onOpenDetails} style={[styles.profileCard, styles.privacySummaryLoading]}><Text style={styles.emptyText}>{error ?? mobileT("mobile.ui.productshell.381429fdad")}</Text></Pressable>;
  return <Pressable accessibilityRole="button" accessibilityLabel={mobileT("mobile.ui.productshell.e721e00e3a")} onPress={onOpenDetails} style={styles.profileCard}>
    <ProfileRow label={mobileT("mobile.ui.productshell.9013849179")} value={privacyAccountLabel(overview)} />
    <ProfileRow label={mobileT("mobile.ui.productshell.597a04d4bb")} value={privacyRemoteModelLabel(overview)} />
    <View style={styles.privacySummaryFooter}><Text style={styles.sectionLink}>{mobileT("mobile.ui.productshell.faea8c1db9")}</Text></View>
  </Pressable>;
}

function PrivacySettingsSheet({ application, userId, refreshKey, canManagePermissions, onManagePermissions, onDismiss }: {
  application: LocalProductKernel;
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
      if (active) setError(mobileT("mobile.ui.productshell.bb11f8db1e"));
    });
    return () => { active = false; };
  }, [application, refreshKey, userId]);
  return <BottomDrawer visible tall title={mobileT("mobile.ui.productshell.3ea651f16f")} subtitle={mobileT("mobile.ui.productshell.d86d778a9b")} onDismiss={onDismiss}>
      {error ? <Text style={styles.formError}>{error}</Text> : overview === undefined ? <View style={styles.privacySheetLoading}><ActivityIndicator color={colors.limeDeep} /></View> : <ScrollView contentContainerStyle={styles.privacyDetailList} showsVerticalScrollIndicator={false}>
        <PrivacyDetailBlock title={mobileT("mobile.ui.productshell.9013849179")} summary={privacyAccountLabel(overview)}>
          <Text style={styles.privacyDetailText}>{privacyAccountDetail(overview)}</Text>
        </PrivacyDetailBlock>
        <PrivacyDetailBlock title={mobileT("mobile.ui.productshell.91bedb8b57")} summary={privacyRemoteModelLabel(overview)}>
          <Text style={styles.privacyDetailText}>{mobileT("mobile.ui.productshell.7f529142f1")}{overview.remoteModel.consent.includedCategories.join("、")}{mobileT("mobile.ui.productshell.7cf1b55e72")}</Text>
          <Text style={styles.privacyDetailText}>{mobileT("mobile.ui.productshell.d5b3234522")}{overview.remoteModel.consent.removedDirectIdentityFields.join("、")}。</Text>
          <Text style={styles.privacyDetailMeta}>{mobileT("mobile.ui.productshell.6f5c2f2999")}{overview.remoteModel.configuration.service} {mobileT("mobile.ui.productshell.9223225d34")}</Text>
          <Text style={styles.privacyDetailMeta}>{mobileT("mobile.ui.productshell.e7079730eb")}</Text>
        </PrivacyDetailBlock>
        {canManagePermissions ? <Pressable accessibilityRole="button" accessibilityLabel={mobileT("mobile.ui.productshell.f60fee9d10")} onPress={onManagePermissions} style={styles.privacyManageButton}><Text style={styles.privacyManageButtonText}>{mobileT("mobile.ui.productshell.ed6476bcad")}</Text></Pressable> : null}
      </ScrollView>}
  </BottomDrawer>;
}

function PrivacyDetailBlock({ title, summary, children }: { title: string; summary: string; children: React.ReactNode }) {
  return <View style={styles.privacyDetailBlock}><View style={styles.privacyDetailHeading}><Text style={styles.privacyDetailTitle}>{title}</Text><Text style={styles.privacyDetailSummary}>{summary}</Text></View>{children}</View>;
}

const recipeReminderCopy: Readonly<Record<Exclude<import("../../coach/model").CoachRecipeKind, "fixed_reminder">, string>> = {
  session_completed_assessment: mobileT("mobile.ui.productshell.7a8214be97"),
  morning_check_in: mobileT("mobile.ui.productshell.5bdd4572ec"),
  recovery_changed: mobileT("mobile.ui.productshell.83509043a5"),
  today_plan_changed: mobileT("mobile.ui.productshell.487e666316"),
  missed_session_review: mobileT("mobile.ui.productshell.18732cd46e"),
  schedule_or_equipment_changed: mobileT("mobile.ui.productshell.d547a4194e"),
  weekly_review: mobileT("mobile.ui.productshell.5e781d485a"),
  deload_ended: mobileT("mobile.ui.productshell.82f7e4099a"),
};

function RecipeReminderSettings({ application, userId, onUpdated }: { application: LocalProductKernel; userId: string; onUpdated: () => void }) {
  const [recipes, setRecipes] = useState<Awaited<ReturnType<LocalProductKernel["listCoachRecipes"]>>>();
  const [busyRecipeId, setBusyRecipeId] = useState<string>();
  const [error, setError] = useState<string>();
  const load = useCallback(async () => {
    await application.ensureDefaultEventRecipes(userId);
    setRecipes((await application.listCoachRecipes(userId)).filter((recipe) => recipe.kind !== "fixed_reminder"));
  }, [application, userId]);
  useEffect(() => { void load().catch((cause: unknown) => setError(userFacingError(cause, mobileT("mobile.ui.productshell.9ba86f1615")))); }, [load]);
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
      setError(userFacingError(cause, mobileT("mobile.ui.productshell.d8c3171708")));
    } finally {
      setBusyRecipeId(undefined);
    }
  };
  return <View style={[styles.profileCard, styles.reminderSettingsCard]}>
    <Text style={[styles.healthConnectionNote, styles.reminderSettingsIntro]}>{mobileT("mobile.ui.productshell.ea6b782a4b")}</Text>
    {recipes === undefined ? <ActivityIndicator color={colors.limeDeep} /> : recipes.map((recipe) => {
      const label = recipeReminderCopy[recipe.kind as keyof typeof recipeReminderCopy];
      return <View key={recipe.id} style={styles.permissionRow}><Text style={[styles.permissionTitle, { flex: 1 }]}>{label}</Text><Pressable accessibilityRole="switch" accessibilityLabel={mobileT("mobile.ui.productshell.6700026687", { value0: label })} accessibilityState={{ checked: recipe.enabled, disabled: busyRecipeId !== undefined }} disabled={busyRecipeId !== undefined} onPress={() => void toggle(recipe)} style={[styles.permissionSwitch, recipe.enabled && styles.permissionSwitchOn, busyRecipeId === recipe.id && styles.primaryButtonDisabled]}><View style={[styles.permissionKnob, recipe.enabled && styles.permissionKnobOn]} /></Pressable></View>;
    })}
    {error ? <Text style={styles.formError}>{error}</Text> : null}
  </View>;
}

const healthConnectionPlatform = Platform.OS === "ios" ? "healthkit" as const : "health_connect" as const;
const healthConnectionMetrics = healthConnectionPlatform === "healthkit"
  ? APPLE_HEALTHKIT_MVP_METRICS
  : ANDROID_HEALTH_CONNECT_MVP_METRICS;
const healthConnectionName = healthConnectionPlatform === "healthkit" ? mobileT("mobile.ui.productshell.6de270c4a7") : "Health Connect";

function HealthConnectionPanel({ application, userId, permissions, sources, onUpdated }: {
  application: LocalProductKernel;
  userId: string;
  permissions: CoachProductProjection["profile"]["permissions"];
  sources: CoachProductProjection["profile"]["healthSources"];
  onUpdated: () => void;
}) {
  const [connection, setConnection] = useState<Awaited<ReturnType<LocalProductKernel["getHealthConnectionState"]>>>();
  const [busy, setBusy] = useState<"permission" | "sync">();
  const [error, setError] = useState<string>();
  const refreshConnection = useCallback(async () => {
    try {
      setConnection(await application.getHealthConnectionState({ metricTypes: healthConnectionMetrics }));
      setError(undefined);
    } catch (cause) {
      setError(userFacingError(cause, mobileT("mobile.ui.productshell.6e10d1ce84")));
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
      setError(userFacingError(cause, mobileT("mobile.ui.productshell.78e29c0255", { value0: healthConnectionName })));
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
      setError(userFacingError(cause, mobileT("mobile.ui.productshell.ae5a413fbb", { value0: healthConnectionName })));
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
      <View style={{ flex: 1 }}><Text style={styles.healthConnectionTitle}>{healthConnectionName}</Text><Text style={styles.healthConnectionMeta}>{connection ? healthConnectionStatus(connection.availability, grants, healthConnectionName) : mobileT("mobile.ui.productshell.01f3a43f96")}</Text></View>
      {busy ? <ActivityIndicator color={colors.limeDeep} /> : null}
    </View>
    <Text style={styles.healthConnectionNote}>{healthConnectionPlatform === "healthkit" ? mobileT("mobile.ui.productshell.7ffc07ca01") : mobileT("mobile.ui.productshell.0596c7dcf4")}</Text>
    {sources.length ? <View style={styles.healthImportedList}>{sources.map((source) => <ProfileRow key={source.platform} label={healthSourceLabel(source.platform)} value={healthSourceSummary(source)} />)}</View> : null}
    {error ? <Text style={styles.formError}>{error}</Text> : null}
    {!permissions ? <Text style={styles.healthConnectionMeta}>{mobileT("mobile.ui.productshell.0617573f0d")}</Text> : <View style={styles.healthConnectionActions}>
      {canRequest ? <Pressable accessibilityRole="button" disabled={busy !== undefined} onPress={() => void requestPermission()} style={[styles.healthConnectionPrimary, busy && styles.primaryButtonDisabled]}><Text style={styles.healthConnectionPrimaryText}>{availability === "permission_denied_or_revoked" ? mobileT("mobile.ui.productshell.203ccc8c45") : mobileT("mobile.ui.productshell.f8e6314ffb")}</Text></Pressable> : null}
      {canSync ? <Pressable accessibilityRole="button" disabled={busy !== undefined} onPress={() => void sync()} style={[styles.healthConnectionSecondary, busy && styles.primaryButtonDisabled]}><Text style={styles.healthConnectionSecondaryText}>{mobileT("mobile.ui.productshell.51e6d9eba4")}</Text></Pressable> : null}
    </View>}
  </View>;
}

function ActionLogViewer({ application, userId, onDismiss }: { application: LocalProductKernel; userId: string; onDismiss: () => void }) {
  const [events, setEvents] = useState<Awaited<ReturnType<LocalProductKernel["listActionLog"]>>>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    void application.listActionLog(userId).then(setEvents).catch((cause: unknown) => {
      setError(userFacingError(cause, mobileT("mobile.ui.productshell.8d8fabc62b")));
    });
  }, [application, userId]);
  return <View style={styles.actionLogScrim}><View style={styles.actionLogSheet}><View style={styles.sheetHandle} /><View style={styles.exerciseManagerHeader}><View style={styles.exerciseManagerHeaderCopy}><Text style={styles.logTitle}>{mobileT("mobile.ui.productshell.6c71a7c375")}</Text><Text style={styles.exerciseManagerSub}>{mobileT("mobile.ui.productshell.0066498cc1")}</Text></View><Pressable accessibilityRole="button" accessibilityLabel={mobileT("mobile.ui.productshell.8662de8f9b")} onPress={onDismiss} style={styles.exerciseClose}><Text style={styles.exerciseCloseText}>{mobileT("mobile.ui.productshell.33246f6a5e")}</Text></Pressable></View><ScrollView contentContainerStyle={styles.actionLogList}>{error ? <Text style={styles.formError}>{error}</Text> : events === undefined ? <ActivityIndicator color={colors.limeDeep} /> : events.length ? events.map((event) => <View key={event.id} style={styles.actionLogDetailRow}><View style={styles.actionLogDetailTop}><Text style={styles.actionLogTitle}>{actionLabel(event.action)}</Text><Text style={styles.actionLogResult}>{actionResultLabel(event.result)}</Text></View><Text style={styles.actionLogDetailMeta}>{actorLabel(event.actor)} · {event.occurredAt.slice(0, 16).replace("T", " ")}</Text>{event.beforeRevision !== undefined || event.afterRevision !== undefined ? <Text style={styles.actionLogDetailMeta}>{mobileT("mobile.ui.productshell.989d1affa0")}{event.beforeRevision ?? "—"} → {event.afterRevision ?? "—"}</Text> : null}{event.reversible && !event.undoneBy ? <Text style={styles.actionLogReversible}>{mobileT("mobile.ui.productshell.c93c3eede8")}</Text> : null}</View>) : <Text style={styles.exerciseEmpty}>{mobileT("mobile.ui.productshell.580aa82639")}</Text>}</ScrollView></View></View>;
}

type CoachMemoryItem = Awaited<ReturnType<LocalProductKernel["listMemory"]>>[number];
type CoachMemoryKind = CoachMemoryItem["kind"];

const coachMemoryKinds: readonly { value: CoachMemoryKind; label: string }[] = [
  { value: "preference", label: mobileT("mobile.ui.productshell.dfdf11c5fd") },
  { value: "focus", label: mobileT("mobile.ui.productshell.7077b38c75") },
  { value: "strategy_note", label: mobileT("mobile.ui.productshell.87dee1684e") },
  { value: "open_question", label: mobileT("mobile.ui.productshell.27b5842c97") },
  { value: "hypothesis", label: mobileT("mobile.ui.productshell.0b48e4bdd8") },
];

function CoachMemoryPanel({ application, userId, onOpen }: { application: LocalProductKernel; userId: string; onOpen: () => void }) {
  const [items, setItems] = useState<readonly CoachMemoryItem[]>();
  useEffect(() => {
    let active = true;
    void application.listMemory(userId).then((next) => { if (active) setItems(next); }).catch(() => { if (active) setItems([]); });
    return () => { active = false; };
  }, [application, userId]);
  const pinned = items?.filter((item) => item.pinned).length ?? 0;
  return <Pressable accessibilityRole="button" accessibilityLabel={mobileT("mobile.ui.productshell.26b67e0767")} onPress={onOpen} style={[styles.profileCard, styles.profileSummaryCard]}>
    <View style={styles.privacySummaryFooter}>
      <View style={styles.profileSummaryCopy}><Text style={styles.profileLabel}>{mobileT("mobile.ui.productshell.f05e9b346c")}</Text><Text style={styles.exerciseManagerSub}>{mobileT("mobile.ui.productshell.7794925912")}</Text></View>
      <Text style={styles.sectionLink}>{items === undefined ? mobileT("mobile.ui.productshell.f7acefd2d4") : mobileT("mobile.ui.productshell.3d65202abf", { value0: items.length, value1: pinned ? mobileT("mobile.ui.productshell.09b1520565", { value0: pinned }) : "" })}</Text>
    </View>
  </Pressable>;
}

function CoachMemorySheet({ application, userId, onDismiss }: { application: LocalProductKernel; userId: string; onDismiss: () => void }) {
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
      setError(userFacingError(cause, mobileT("mobile.ui.productshell.ea16c39346")));
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
    if (!content.trim()) { setError(mobileT("mobile.ui.productshell.8964d6c976")); return; }
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
      setError(userFacingError(cause, mobileT("mobile.ui.productshell.0efec584b7")));
    } finally { setBusy(false); }
  };
  const togglePin = async (item: CoachMemoryItem) => {
    setBusy(true);
    try { await application.setMemoryPinned({ userId, id: item.id, expectedVersion: item.version, pinned: !item.pinned }); await refresh(); }
    catch (cause) { setError(userFacingError(cause, mobileT("mobile.ui.productshell.400c30157e"))); }
    finally { setBusy(false); }
  };
  const forget = async (item: CoachMemoryItem) => {
    setBusy(true);
    try { await application.forgetMemory({ userId, id: item.id, expectedVersion: item.version }); await refresh(); }
    catch (cause) { setError(userFacingError(cause, mobileT("mobile.ui.productshell.32b88ed594"))); }
    finally { setBusy(false); }
  };
  return <View accessibilityViewIsModal style={styles.permissionScrim}>
    <View style={coachMemoryStyles.sheet}>
      <View style={styles.sheetHandle} />
      <View style={styles.exerciseManagerHeader}><View style={styles.exerciseManagerHeaderCopy}><Text style={styles.logTitle}>{mobileT("mobile.ui.productshell.dc9f2a12e0")}</Text><Text style={styles.exerciseManagerSub}>{mobileT("mobile.ui.productshell.2f75cadeb8")}</Text></View><Pressable accessibilityRole="button" accessibilityLabel={mobileT("mobile.ui.productshell.2c371f6c82")} onPress={onDismiss} style={styles.exerciseClose}><Text style={styles.exerciseCloseText}>{mobileT("mobile.ui.productshell.33246f6a5e")}</Text></Pressable></View>
      <ScrollView contentContainerStyle={coachMemoryStyles.body} keyboardShouldPersistTaps="handled">
        <View style={coachMemoryStyles.editor}>
          <Text style={coachMemoryStyles.editorTitle}>{editing ? mobileT("mobile.ui.productshell.eb79e220e6") : mobileT("mobile.ui.productshell.8795e8e3d1")}</Text>
          <View style={coachMemoryStyles.kindRow}>{coachMemoryKinds.map((candidate) => <Pressable key={candidate.value} accessibilityRole="radio" accessibilityState={{ selected: kind === candidate.value }} onPress={() => setKind(candidate.value)} style={[coachMemoryStyles.kindChip, kind === candidate.value && coachMemoryStyles.kindChipSelected]}><Text style={[coachMemoryStyles.kindText, kind === candidate.value && coachMemoryStyles.kindTextSelected]}>{candidate.label}</Text></Pressable>)}</View>
          <TextInput accessibilityLabel={mobileT("mobile.ui.productshell.0f76a2a1d0")} value={content} onChangeText={setContent} multiline maxLength={1000} placeholder={mobileT("mobile.ui.productshell.88c310eca5")} placeholderTextColor={colors.ink3} style={coachMemoryStyles.input} />
          <View style={coachMemoryStyles.optionRow}><Pressable accessibilityRole="checkbox" accessibilityState={{ checked: pinned }} onPress={() => setPinned((value) => !value)} style={coachMemoryStyles.option}><Text style={coachMemoryStyles.optionMark}>{pinned ? "✓" : "○"}</Text><Text style={coachMemoryStyles.optionText}>{mobileT("mobile.ui.productshell.a0f83c64ca")}</Text></Pressable><Pressable accessibilityRole="checkbox" accessibilityState={{ checked: sensitivity === "private" }} onPress={() => setSensitivity((value) => value === "private" ? "normal" : "private")} style={coachMemoryStyles.option}><Text style={coachMemoryStyles.optionMark}>{sensitivity === "private" ? "✓" : "○"}</Text><Text style={coachMemoryStyles.optionText}>{mobileT("mobile.ui.productshell.5ffafdb4ad")}</Text></Pressable></View>
          {error ? <Text style={styles.formError}>{error}</Text> : null}
          <View style={coachMemoryStyles.editorActions}>{editing ? <Pressable accessibilityRole="button" onPress={resetEditor} style={coachMemoryStyles.cancel}><Text style={coachMemoryStyles.cancelText}>{mobileT("mobile.ui.productshell.c698df948d")}</Text></Pressable> : null}<Pressable accessibilityRole="button" disabled={busy} onPress={() => void save()} style={[coachMemoryStyles.save, busy && styles.primaryButtonDisabled]}><Text style={coachMemoryStyles.saveText}>{editing ? mobileT("mobile.ui.productshell.60b4ae9082") : mobileT("mobile.ui.productshell.7b788ed201")}</Text></Pressable></View>
        </View>
        <Text style={coachMemoryStyles.listTitle}>{mobileT("mobile.ui.productshell.cdfab96f75")}</Text>
        {items === undefined ? <ActivityIndicator color={colors.limeDeep} /> : items.length ? items.map((item) => <View key={item.id} style={coachMemoryStyles.item}><View style={coachMemoryStyles.itemHead}><Text style={coachMemoryStyles.itemKind}>{coachMemoryKinds.find((candidate) => candidate.value === item.kind)?.label ?? item.kind}</Text><Text style={coachMemoryStyles.itemMeta}>{item.pinned ? mobileT("mobile.ui.productshell.6301fb5e3c") : item.provenance.actor === "agent" ? mobileT("mobile.ui.productshell.663b821f22") : mobileT("mobile.ui.productshell.5eb3ddd266")}{item.sensitivity === "private" ? mobileT("mobile.ui.productshell.673404b432") : ""}</Text></View><Text style={coachMemoryStyles.itemContent}>{item.content}</Text><View style={coachMemoryStyles.itemActions}><Pressable accessibilityRole="button" disabled={busy} onPress={() => edit(item)}><Text style={coachMemoryStyles.itemActionText}>{mobileT("mobile.ui.productshell.a7f814c0a4")}</Text></Pressable><Pressable accessibilityRole="button" disabled={busy} onPress={() => void togglePin(item)}><Text style={coachMemoryStyles.itemActionText}>{item.pinned ? mobileT("mobile.ui.productshell.09250f2cdb") : mobileT("mobile.ui.productshell.f34fcf6d32")}</Text></Pressable><Pressable accessibilityRole="button" disabled={busy} onPress={() => void forget(item)}><Text style={coachMemoryStyles.deleteText}>{mobileT("mobile.ui.productshell.3755f56f2f")}</Text></Pressable></View></View>) : <Text style={styles.emptyText}>{mobileT("mobile.ui.productshell.acc6970cd6")}</Text>}
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
type PermissionSettingsKey = Exclude<keyof PermissionSettingsValue, "revision" | "id" | "remoteLlmDisclosure" | "remoteLlm" | "camera">;
type PlanAuthorizationValue = NonNullable<CoachProductProjection["profile"]["planAuthorization"]>;

const permissionSettings: readonly { key: PermissionSettingsKey; label: string; description: string }[] = [
  { key: "health", label: mobileT("mobile.ui.productshell.0cd894e993"), description: mobileT("mobile.ui.productshell.b72a76e88c") },
  { key: "notifications", label: mobileT("mobile.ui.productshell.81944e48a3"), description: mobileT("mobile.ui.productshell.dd2a33cf71") },
];

function PermissionSettings({ application, userId, permissions, planAuthorization, onDismiss, onUpdated }: { application: LocalProductKernel; userId: string; permissions?: PermissionSettingsValue; planAuthorization?: PlanAuthorizationValue; onDismiss: () => void; onUpdated: () => void }) {
  const [busy, setBusy] = useState<PermissionSettingsKey | "plan_authorization">();
  const [error, setError] = useState<string>();
  const setPermission = async (key: PermissionSettingsKey, value: "granted" | "denied") => {
    if (!permissions) return;
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
      setError(userFacingError(cause, mobileT("mobile.ui.productshell.be66c9fa8d")));
    } finally {
      setBusy(undefined);
    }
    if (updated) onUpdated();
  };
  const toggle = (key: PermissionSettingsKey, enabled: boolean) => {
    void setPermission(key, enabled ? "denied" : "granted");
  };
  const setPlanAuthorization = async (value: NonNullable<PlanAuthorizationValue["mandate"]["planChangeAuthorization"]>) => {
    if (!planAuthorization) return;
    setBusy("plan_authorization");
    let updated = false;
    try {
      const key = `mobile-plan-authorization:${planAuthorization.revision}:${value}:${Date.now().toString(36)}`;
      await application.updateCoachingMandateFromSettings({
        userId,
        mandateId: planAuthorization.mandate.id,
        expectedRevision: planAuthorization.revision,
        mandate: { ...planAuthorization.mandate, planChangeAuthorization: value },
        authorization: { kind: "local_user_presence", verifiedAt: new Date().toISOString(), nonce: key },
        idempotencyKey: key,
      });
      updated = true;
    } catch (cause) {
      setError(userFacingError(cause, mobileT("mobile.ui.productshell.be66c9fa8d")));
    } finally {
      setBusy(undefined);
    }
    if (updated) onUpdated();
  };
  return (
    <View style={styles.permissionScrim}>
      <View style={styles.permissionSheet}>
        <View style={styles.sheetHandle} />
        <View style={styles.exerciseManagerHeader}><View style={styles.exerciseManagerHeaderCopy}><Text style={styles.logTitle}>{mobileT("mobile.ui.productshell.669bf8c809")}</Text><Text style={styles.exerciseManagerSub}>{mobileT("mobile.ui.productshell.ea4490e111")}</Text></View><Pressable accessibilityRole="button" accessibilityLabel={mobileT("mobile.ui.productshell.0163ba8d58")} onPress={onDismiss} style={styles.exerciseClose}><Text style={styles.exerciseCloseText}>{mobileT("mobile.ui.productshell.33246f6a5e")}</Text></Pressable></View>
        <ScrollView contentContainerStyle={styles.permissionList}>
          {permissions ? permissionSettings.map((setting) => {
            const value = permissions[setting.key];
            const enabled = value === "granted";
            return <View key={setting.key} style={styles.permissionRow}><View style={styles.permissionBody}><Text style={styles.permissionTitle}>{setting.label}</Text><Text style={styles.permissionDescription}>{setting.description}</Text></View><Pressable accessibilityRole="switch" accessibilityState={{ checked: enabled, disabled: busy !== undefined }} disabled={busy !== undefined} onPress={() => toggle(setting.key, enabled)} style={[styles.permissionSwitch, enabled && styles.permissionSwitchOn, busy === setting.key && styles.primaryButtonDisabled]}><View style={[styles.permissionKnob, enabled && styles.permissionKnobOn]} /></Pressable></View>;
          }) : null}
          {planAuthorization ? <View style={styles.permissionBody}>
            <Text style={styles.permissionTitle}>{mobileT("mobile.profile.planAuthorization.title")}</Text>
            <Text style={styles.permissionDescription}>{mobileT("mobile.profile.planAuthorization.description")}</Text>
            <View accessibilityRole="radiogroup" style={coachMemoryStyles.kindRow}>{(["ask_this_time", "always_ask", "allow_once", "allow_similar_small", "deny"] as const).map((authorization) => <Pressable key={authorization} accessibilityRole="radio" accessibilityState={{ checked: planAuthorization.mandate.planChangeAuthorization === authorization, disabled: busy !== undefined }} disabled={busy !== undefined} onPress={() => void setPlanAuthorization(authorization)} style={[coachMemoryStyles.kindChip, planAuthorization.mandate.planChangeAuthorization === authorization && coachMemoryStyles.kindChipSelected]}><Text style={[coachMemoryStyles.kindText, planAuthorization.mandate.planChangeAuthorization === authorization && coachMemoryStyles.kindTextSelected]}>{planAuthorizationLabel(authorization)}</Text></Pressable>)}</View>
          </View> : null}
          {error ? <Text style={styles.formError}>{error}</Text> : null}
        </ScrollView>
      </View>
    </View>
  );
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

function WorkoutScreen({ application, userId, workoutId, onOpenCoach, onFinished, onUnavailable }: {
  application: LocalProductKernel;
  userId: string;
  workoutId: string;
  onOpenCoach: () => void;
  onFinished: () => void;
  onUnavailable: () => void;
}) {
  const [workout, setWorkout] = useState<Awaited<ReturnType<LocalProductKernel["readWorkoutSession"]>>>();
  const [error, setError] = useState<string>();
  const [restRemaining, setRestRemaining] = useState<number | null>(null);
  const [editingActual, setEditingActual] = useState(false);
  const [editingTarget, setEditingTarget] = useState(false);
  const [actualReps, setActualReps] = useState("");
  const [actualLoad, setActualLoad] = useState("");
  const [actualLoadUnit, setActualLoadUnit] = useState<"kg" | "lb" | undefined>();
  const [actualRir, setActualRir] = useState("");
  const [noviceFeedback, setNoviceFeedback] = useState<"easy" | "appropriate" | "hard" | undefined>();
  const [targetReps, setTargetReps] = useState("");
  const [targetLoad, setTargetLoad] = useState("");
  const [targetRir, setTargetRir] = useState("");
  const [managingUpcomingTasks, setManagingUpcomingTasks] = useState(false);
  const [showSafetyPauseChoices, setShowSafetyPauseChoices] = useState(false);
  const [showSkipSet, setShowSkipSet] = useState(false);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [finishReviewOpen, setFinishReviewOpen] = useState(false);
  const [finishSaveState, setFinishSaveState] = useState<"idle" | "saving" | "failed" | "conflict">("idle");
  const [removedTaskUndo, setRemovedTaskUndo] = useState<{ task: PlannedExerciseTask; index: number }>();
  const load = useCallback(async () => {
    try {
      setWorkout(await application.readWorkoutSession({ userId, workoutId }));
      setError(undefined);
    } catch (cause) {
      setError(userFacingError(cause, mobileT("mobile.ui.productshell.d37b8f28a9")));
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
    ? <ErrorState title={mobileT("mobile.ui.productshell.bb2b8a9927")} message={error} onRetry={onUnavailable} retryLabel={mobileT("mobile.ui.productshell.cff1ad3d04")} />
    : <LoadingState />;
  if (workout.status === "paused") {
    return <PausedWorkoutScreen application={application} userId={userId} workoutId={workoutId} reason={workout.state.pauseReason} onFinished={onFinished} onResumed={() => void load()} />;
  }
  const completed = new Set(workout.setOutcomes.map((outcome) => outcome.prescriptionSetId));
  const skipped = new Set((workout.skippedSets ?? []).map((set) => set.prescriptionSetId));
  const resolved = new Set([...completed, ...skipped]);
  const pendingSets = workout.frozenPrescription.tasks.flatMap((task) => task.sets.map((set) => ({ task, set })));
  const pending = pendingSets.find(({ set }) => set.id === workout.state.currentSetId && !resolved.has(set.id))
    ?? pendingSets.find(({ set }) => !resolved.has(set.id));
  const pendingDraft = pending ? workout.drafts.find((draft) => draft.prescriptionSetId === pending.set.id) : undefined;
  const pendingSetIndex = pending ? pending.task.sets.findIndex((set) => set.id === pending.set.id) + 1 : 0;
  const startRest = async (setId: string, duration: { value: number; unit: "seconds" | "minutes" | "hours" }) => {
    await application.startRestTimer({
      userId,
      workoutId,
      setId,
      duration,
      idempotencyKey: `mobile-workout:${workoutId}:rest:${setId}`,
    });
  };
  const skipCurrentSet = async (reason: string) => {
    if (!pending) return;
    try {
      await application.skipCurrentSet({ userId, workoutId, reason, idempotencyKey: `mobile-workout:${workoutId}:skip:${pending.set.id}` });
      setShowSkipSet(false);
      await load();
    } catch (cause) {
      setError(userFacingError(cause, mobileT("mobile.ui.productshell.6bd22a7679")));
    }
  };
  const openActual = () => {
    if (!pending) return;
    setActualReps(pendingDraft?.actualReps !== undefined
      ? String(pendingDraft.actualReps)
      : "");
    setActualLoad(pendingDraft?.actualLoad ? String(pendingDraft.actualLoad.value) : "");
    setActualLoadUnit(pendingDraft?.actualLoad?.unit);
    setActualRir(pendingDraft?.actualRir !== undefined ? String(pendingDraft.actualRir) : "");
    setNoviceFeedback(pendingDraft?.noviceFeedback);
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
      setError(mobileT("mobile.ui.productshell.f0cece115f"));
      return;
    }
    if (actualLoadValue !== undefined && actualLoadValue < 0) { setError(mobileT("mobile.ui.productshell.2f108951e3")); return; }
    if (actualLoadValue !== undefined && actualLoadUnit === undefined) { setError(mobileT("mobile.ui.productshell.a81cebac2b")); return; }
    if (rir !== undefined && (rir < 0 || rir > 10)) { setError(mobileT("mobile.ui.productshell.321399dc76")); return; }
    const draft = await application.saveCurrentSetDraft({
        userId,
        workoutId,
        idempotencyKey: `mobile-workout:${workoutId}:draft:${pending.set.id}`,
        draft: {
          ...(reps !== undefined ? { actualReps: reps } : {}),
          ...(actualLoadValue !== undefined && actualLoadUnit ? { actualLoad: { value: actualLoadValue, unit: actualLoadUnit } } : {}),
          ...(rir !== undefined ? { actualRir: rir } : {}),
          ...(noviceFeedback ? { noviceFeedback, noviceFeedbackMappingVersion: "set-review-v1" } : {}),
        },
      });
    return { draft, reps, actualLoadValue, rir };
  };
  const saveActualDraft = async () => {
    try {
      await persistActualDraft();
      setEditingActual(false);
      await load();
    } catch (cause) { setError(userFacingError(cause, mobileT("mobile.ui.productshell.f7b5d2130e"))); }
  };
  const confirmActual = async () => {
    if (!pending) return;
    try {
      const saved = await persistActualDraft();
      if (!saved) return;
      const { draft } = saved;
      await application.confirmCurrentSet({ userId, workoutId, draftId: draft.id, idempotencyKey: `mobile-workout:${workoutId}:confirm:${pending.set.id}` });
      const rest = pending.set.rest ?? workout.state.policy.defaultRest;
      if (rest) await startRest(pending.set.id, rest);
      setEditingActual(false);
      await load();
    } catch (cause) { setError(userFacingError(cause, mobileT("mobile.ui.productshell.4894afa807"))); }
  };
  const saveTarget = async () => {
    if (!pending) return;
    const reps = optionalFiniteNumber(targetReps);
    const targetLoadValue = optionalFiniteNumber(targetLoad);
    const rir = optionalFiniteNumber(targetRir);
    if (pending.set.targetReps && (reps === undefined || !Number.isInteger(reps) || reps < 0)) {
      setError(mobileT("mobile.ui.productshell.e68165d161"));
      return;
    }
    if (targetLoadValue !== undefined && targetLoadValue < 0) { setError(mobileT("mobile.ui.productshell.90291e6184")); return; }
    if (rir !== undefined && (rir < 0 || rir > 10)) { setError(mobileT("mobile.ui.productshell.0ca0ed4b7b")); return; }
    try {
      const change = {
        kind: "adjust_set" as const,
        taskId: pending.task.id,
        setId: pending.set.id,
        patch: {
          ...(pending.set.targetReps && reps !== undefined ? { targetReps: { min: reps, max: reps } } : {}),
          ...(pending.set.targetLoad && targetLoadValue !== undefined ? { targetLoad: { value: targetLoadValue, unit: pending.set.targetLoad.unit } } : {}),
          ...(rir !== undefined ? { targetRir: rir } : {}),
        },
      };
      await application.editUpcomingWorkoutPlan({ userId, workoutId, change, reason: "user_adjusted_unstarted_set", idempotencyKey: `mobile-workout:${workoutId}:revise:${pending.set.id}` });
      setEditingTarget(false);
      await load();
    } catch (cause) { setError(userFacingError(cause, mobileT("mobile.ui.productshell.ac463ab5f7"))); }
  };
  const finish = async () => {
    try {
      setFinishSaveState("saving");
      await application.completeWorkoutSession({ userId, workoutId, status: pending ? "partial" : "completed", idempotencyKey: `mobile-workout:${workoutId}:finish` });
      setFinishSaveState("idle");
      onFinished();
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : mobileT("mobile.ui.productshell.114f115186");
      const conflict = /conflict|revision/i.test(detail);
      setFinishSaveState(conflict ? "conflict" : "failed");
      setError(conflict ? mobileT("mobile.ui.productshell.3b7a25145f") : mobileT("mobile.ui.productshell.a31f3ae772"));
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
    } catch (cause) { setError(userFacingError(cause, mobileT("mobile.ui.productshell.13777f7c6f"))); }
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
    } catch (cause) { setError(userFacingError(cause, mobileT("mobile.ui.productshell.e5b39de530"))); }
  };
  const pause = async () => {
    try {
      await application.pauseWorkoutSession({
        userId,
        workoutId,
        idempotencyKey: `mobile-workout:${workoutId}:pause`,
      });
      await load();
    } catch (cause) { setError(userFacingError(cause, mobileT("mobile.ui.productshell.1cdd25e544"))); }
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
    } catch (cause) { setError(userFacingError(cause, mobileT("mobile.ui.productshell.1cdd25e544"))); }
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
      setError(userFacingError(cause, mobileT("mobile.ui.productshell.b4a5fb7e67")));
    }
  };
  const currentExerciseOutcomes = pending
    ? workout.setOutcomes.filter((outcome) => outcome.exerciseVariantId === pending.task.exerciseVariantId)
    : [];
  const switchableTasks = workout.frozenPrescription.tasks.filter((task) => task.sets.some((set) => !resolved.has(set.id)));
  const switchableTaskIndex = pending ? switchableTasks.findIndex((task) => task.id === pending.task.id) : -1;
  const swipeCurrentCard = (direction: "previous" | "next") => {
    const offset = direction === "next" ? 1 : -1;
    const task = switchableTasks[switchableTaskIndex + offset];
    if (task) void focusTask(task.id);
  };
  const undoRemovedTask = async () => {
    if (!removedTaskUndo) return;
    try {
      const change = { kind: "add_task" as const, task: removedTaskUndo.task, index: removedTaskUndo.index };
      const key = `mobile-workout:${workoutId}:undo-remove-task:${removedTaskUndo.task.id}:${workout.revision}`;
      await application.editUpcomingWorkoutPlan({ userId, workoutId, change, reason: "user_undid_removed_unstarted_task", idempotencyKey: key });
      setRemovedTaskUndo(undefined);
      await load();
    } catch (cause) {
      setError(userFacingError(cause, mobileT("mobile.ui.productshell.1b2a218f1e")));
    }
  };
  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.workoutTop}><View><Text style={styles.screenTitle}>{readablePlanSessionTitle(workout.frozenPrescription.title)}</Text><Text style={styles.screenSub}>{mobileT("mobile.ui.productshell.85b1c821ec")}</Text></View><View style={styles.workoutTopActions}>{skipped.size ? <Text style={{ color: colors.terra, fontSize: 11, fontWeight: "800" }}>{mobileT("mobile.ui.productshell.9f38afd41e")}{skipped.size} {mobileT("mobile.ui.productshell.726ff2fac5")}</Text> : null}<Pressable accessibilityRole="button" accessibilityLabel={mobileT("mobile.ui.productshell.14c0b43542")} onPress={onOpenCoach} style={styles.workoutCoachButton}><Text style={styles.workoutCoachButtonText}>Coach</Text></Pressable></View></View>
      {restRemaining !== null ? <View style={styles.restCard}><View><Text style={styles.cardEyebrow}>{mobileT("mobile.ui.productshell.8b0b189c16")}</Text><Text style={styles.restTime}>{formatRestSeconds(restRemaining)}</Text>{pending ? <ProfessionalTermText text={mobileT("mobile.ui.productshell.eb81279e39", { value0: exerciseDisplayName(pending.task.exerciseVariantId), value1: setDose(pending.set) })} style={styles.workoutTaskBoundary} /> : <Text style={styles.workoutTaskBoundary}>{mobileT("mobile.ui.productshell.c74e75468d")}</Text>}</View><View style={styles.restActions}><Pressable accessibilityRole="button" accessibilityLabel={mobileT("mobile.ui.productshell.c64f281f6e")} onPress={() => void adjustRest(-30)} style={styles.restAdd}><Text style={styles.restAddText}>{mobileT("mobile.ui.productshell.13b0c41493")}</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel={mobileT("mobile.ui.productshell.98cac1b6c0")} onPress={() => void adjustRest(30)} style={styles.restAdd}><Text style={styles.restAddText}>{mobileT("mobile.ui.productshell.abdcb2973b")}</Text></Pressable><Pressable accessibilityRole="button" onPress={() => void cancelRest()} style={styles.restCancel}><Text style={styles.restCancelText}>{mobileT("mobile.ui.productshell.76b9880829")}</Text></Pressable></View></View> : null}
      {pending ? (
        <WorkoutSetFlipCard
          flipped={historyExpanded}
          swipeEnabled={!editingActual && !editingTarget && !historyExpanded}
          onSwipe={swipeCurrentCard}
          front={<>
          <View style={styles.currentSetHeader}><Text style={styles.cardEyebrow}>{mobileT("mobile.ui.productshell.3e19ec2c0b")}{pendingSetIndex} {mobileT("mobile.ui.productshell.726ff2fac5")}</Text>{currentExerciseOutcomes.length ? <Pressable accessibilityRole="button" accessibilityLabel={mobileT("mobile.ui.productshell.6f11dc5a77", { value0: historyExpanded ? mobileT("mobile.ui.productshell.5d5815647c") : mobileT("mobile.ui.productshell.f7acefd2d4"), value1: currentExerciseOutcomes.length })} accessibilityState={{ expanded: historyExpanded }} onPress={() => setHistoryExpanded((value) => !value)} style={styles.completedHistoryButton}><Text style={styles.completedHistoryButtonText}>{mobileT("mobile.ui.productshell.e99b48a29b")}{currentExerciseOutcomes.length} {mobileT("mobile.ui.productshell.e9f2c96d10")}</Text></Pressable> : <Text style={styles.notRecordedText}>{mobileT("mobile.ui.productshell.55fba87777")}</Text>}</View>
          <Text style={styles.currentSetTitle}>{exerciseDisplayName(pending.task.exerciseVariantId)}</Text>
          <ProfessionalTermText text={setDose(pending.set)} style={styles.currentSetDose} />
          <ProfessionalTermText text={mobileT("mobile.ui.productshell.56587f2e78")} style={styles.currentSetBoundary} />
          {editingActual ? (
            <View style={styles.actualForm}>
              <Text style={styles.setReviewTitle}>{mobileT("mobile.ui.productshell.ddfa264136")}</Text>
              <ProfessionalTermText text={setDose(pending.set)} prefix={mobileT("mobile.ui.productshell.c018c0bed0")} style={styles.setReviewSnapshot} />
              <Text style={styles.setReviewSnapshot}>{mobileT("mobile.ui.productshell.e88c63650d")}</Text>
              <ActualInput label={mobileT("mobile.ui.productshell.d4a97e7577")} value={actualReps} onChange={setActualReps} />
              <ActualInput label={mobileT("mobile.ui.productshell.0a4f2ecb1c")} value={actualLoad} onChange={setActualLoad} />
              <View accessibilityRole="radiogroup" style={styles.setActions}><Pressable accessibilityRole="radio" accessibilityState={{ checked: actualLoadUnit === "kg" }} onPress={() => setActualLoadUnit("kg")} style={[styles.actualButton, actualLoadUnit === "kg" && styles.workoutTaskSelected]}><Text style={styles.actualButtonText}>kg</Text></Pressable><Pressable accessibilityRole="radio" accessibilityState={{ checked: actualLoadUnit === "lb" }} onPress={() => setActualLoadUnit("lb")} style={[styles.actualButton, actualLoadUnit === "lb" && styles.workoutTaskSelected]}><Text style={styles.actualButtonText}>lb</Text></Pressable></View>
              <ActualInput label={mobileT("mobile.ui.productshell.f5249a281b")} value={actualRir} onChange={setActualRir} />
              <Text style={styles.setReviewSnapshot}>{mobileT("mobile.ui.productshell.5b01d8b46f")}</Text>
              <View accessibilityRole="radiogroup" style={styles.setActions}>{([['easy', mobileT("mobile.ui.productshell.c9c4a72eeb")], ['appropriate', mobileT("mobile.ui.productshell.e523b6ab39")], ['hard', mobileT("mobile.ui.productshell.6ee6e775bb")]] as const).map(([value, label]) => <Pressable key={value} accessibilityRole="radio" accessibilityState={{ checked: noviceFeedback === value }} onPress={() => setNoviceFeedback((current) => current === value ? undefined : value)} style={[styles.actualButton, noviceFeedback === value && styles.workoutTaskSelected]}><Text style={styles.actualButtonText}>{label}</Text></Pressable>)}</View>
              <Pressable accessibilityRole="button" onPress={() => void confirmActual()} style={styles.primaryButton}><Text style={styles.primaryButtonText}>{mobileT("mobile.ui.productshell.50cd81ea17")}</Text></Pressable>
              <Pressable accessibilityRole="button" onPress={() => void saveActualDraft()} style={styles.actualButton}><Text style={styles.actualButtonText}>{mobileT("mobile.ui.productshell.ccc49af3b2")}</Text></Pressable>
            </View>
          ) : editingTarget ? (
            <View style={styles.actualForm}>
              <ActualInput label={mobileT("mobile.ui.productshell.2acbbfd778")} value={targetReps} onChange={setTargetReps} />
              {pending.set.targetLoad ? <ActualInput label={mobileT("mobile.ui.productshell.701137047a")} value={targetLoad} onChange={setTargetLoad} /> : null}
              <ActualInput label={mobileT("mobile.ui.productshell.51ab19e0e1")} value={targetRir} onChange={setTargetRir} />
              <Text style={styles.currentSetBoundary}>{mobileT("mobile.ui.productshell.3ff229db69")}</Text>
              <Pressable accessibilityRole="button" onPress={() => void saveTarget()} style={styles.primaryButton}><Text style={styles.primaryButtonText}>{mobileT("mobile.ui.productshell.9e77acc723")}</Text></Pressable>
            </View>
          ) : (
            <>
              <Pressable accessibilityRole="button" onPress={openActual} style={styles.primaryButton}><Text style={styles.primaryButtonText}>{mobileT("mobile.ui.productshell.5b7324c4a8")}</Text></Pressable>
              <View style={styles.setActions}>
                <Pressable accessibilityRole="button" onPress={openTarget} style={styles.actualButton}><Text style={styles.actualButtonText}>{mobileT("mobile.ui.productshell.1de1acaa7f")}</Text></Pressable>
                <Pressable accessibilityRole="button" onPress={() => setShowSkipSet(true)} style={styles.actualButton}><Text style={styles.skipSetText}>{mobileT("mobile.ui.productshell.bf8b274f68")}</Text></Pressable>
              </View>
            </>
          )}
          {!editingActual && !editingTarget ? <Pressable accessibilityRole="button" onPress={() => setManagingUpcomingTasks(true)} style={styles.manageWorkoutTasksButton}><Text style={styles.manageWorkoutTasksText}>{mobileT("mobile.ui.productshell.04e9ef97d3")}</Text></Pressable> : null}
          </>}
          back={<><View style={styles.currentSetHeader}><View><Text style={styles.cardEyebrow}>{mobileT("mobile.ui.productshell.d9cb1f81b0")}</Text><Text style={styles.currentSetTitle}>{exerciseDisplayName(pending.task.exerciseVariantId)}</Text></View><Pressable accessibilityRole="button" accessibilityLabel={mobileT("mobile.ui.productshell.1cc07b3eb9")} onPress={() => setHistoryExpanded(false)} style={styles.completedHistoryButton}><Text style={styles.completedHistoryButtonText}>{mobileT("mobile.ui.productshell.c2aa1928a6")}</Text></Pressable></View><CompletedSetHistory outcomes={currentExerciseOutcomes} /></>}
        />
      ) : <Empty label={mobileT("mobile.ui.productshell.24aabd5f85")} />}
      <Text style={styles.sectionTitle}>{mobileT("mobile.ui.productshell.81cec5c455")}</Text>
      {workout.frozenPrescription.tasks.map((task) => {
        const taskCompleted = workout.setOutcomes.filter((outcome) => outcome.exerciseVariantId === task.exerciseVariantId).length;
        const hasPending = task.sets.some((set) => !resolved.has(set.id));
        return <Pressable key={task.id} accessibilityRole="button" accessibilityLabel={mobileT("mobile.ui.productshell.61a55d2718", { value0: exerciseDisplayName(task.exerciseVariantId) })} accessibilityState={{ selected: pending?.task.id === task.id, disabled: !hasPending }} disabled={!hasPending} onPress={() => void focusTask(task.id)} style={[styles.workoutTask, pending?.task.id === task.id && styles.workoutTaskSelected]}><View style={styles.workoutRouteRow}><View style={{ flex: 1 }}><Text style={styles.workoutTaskTitle}>{exerciseDisplayName(task.exerciseVariantId)}</Text><Text style={styles.workoutRouteMeta}>{taskCompleted ? mobileT("mobile.ui.productshell.71272a1c9d", { value0: taskCompleted }) : mobileT("mobile.ui.productshell.55fba87777")}</Text></View><Text style={styles.chevron}>›</Text></View></Pressable>;
      })}
      {removedTaskUndo ? <View style={styles.workoutNotice}><Text style={styles.workoutNoticeDetail}>{mobileT("mobile.ui.productshell.4e5c4958dd")}{exerciseDisplayName(removedTaskUndo.task.exerciseVariantId)}{mobileT("mobile.ui.productshell.efde97170b")}</Text><Pressable accessibilityRole="button" onPress={() => void undoRemovedTask()} style={styles.workoutTaskSecondary}><Text style={styles.workoutTaskSecondaryText}>{mobileT("mobile.ui.productshell.f83e9251eb")}</Text></Pressable></View> : null}
      {error ? <Text style={styles.formError}>{error}</Text> : null}
      <Pressable accessibilityRole="button" onPress={() => void pause()} style={styles.pauseButton}><Text style={styles.pauseButtonText}>{mobileT("mobile.ui.productshell.cb990e4699")}</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={() => setShowSafetyPauseChoices(true)} style={styles.safetyPauseButton}><Text style={styles.safetyPauseButtonText}>{mobileT("mobile.ui.productshell.40e179a954")}</Text></Pressable>
      {finishReviewOpen ? <View style={styles.workoutTaskPicker}><Text style={styles.logTitle}>{mobileT("mobile.ui.productshell.e14bc9de1f")}</Text><Text style={styles.workoutTaskBoundary}>{mobileT("mobile.ui.productshell.e99b48a29b")}{workout.setOutcomes.length} {mobileT("mobile.ui.productshell.1ccd8f52e5")}{skipped.size} </Text>{workout.setOutcomes.map((outcome, index) => <View key={outcome.id} style={styles.completedHistoryRow}><Text style={styles.completedHistoryIndex}>{index + 1}</Text><Text style={styles.completedHistoryDose}>{exerciseDisplayName(outcome.exerciseVariantId)}</Text><Text style={styles.completedHistoryDelta}>{outcome.actualLoad ? `${outcome.actualLoad.value}${outcome.actualLoad.unit} × ` : ""}{outcome.actualReps ?? outcome.actualDuration?.value ?? outcome.actualDistance?.value ?? "—"}{outcome.actualRir === undefined ? "" : mobileT("mobile.ui.productshell.c428b6ec11", { value0: outcome.actualRir })}</Text></View>)}{(workout.skippedSets ?? []).map((item) => <Text key={item.id} style={styles.workoutTaskBoundary}>{mobileT("mobile.ui.productshell.c1b1114d07")}{exerciseDisplayName(item.exerciseVariantId)} · {item.reason}</Text>)}{workout.frozenPrescription.tasks.filter((task) => task.id.includes(":replacement:")).map((task) => <Text key={task.id} style={styles.workoutTaskBoundary}>{mobileT("mobile.ui.productshell.8b19275238")}{exerciseDisplayName(task.exerciseVariantId)}</Text>)}<Text style={styles.workoutTaskBoundary}>{mobileT("mobile.ui.productshell.1da06efc7b")}{finishSaveState === "saving" ? mobileT("mobile.ui.productshell.a4d77e6a76") : finishSaveState === "conflict" ? mobileT("mobile.ui.productshell.e6c04496ef") : finishSaveState === "failed" ? mobileT("mobile.ui.productshell.dcf6d3e49e") : mobileT("mobile.ui.productshell.25a45621ed")}</Text><View style={styles.workoutTaskButtons}><Pressable accessibilityRole="button" disabled={finishSaveState === "saving"} onPress={() => setFinishReviewOpen(false)} style={styles.workoutTaskSecondary}><Text style={styles.workoutTaskSecondaryText}>{mobileT("mobile.ui.productshell.3166554c46")}</Text></Pressable><Pressable accessibilityRole="button" disabled={finishSaveState === "saving"} onPress={() => void finish()} style={styles.workoutConfirmButton}><Text style={styles.workoutConfirmButtonText}>{finishSaveState === "failed" || finishSaveState === "conflict" ? mobileT("mobile.ui.productshell.48a0cad32a") : pending ? mobileT("mobile.ui.productshell.b56377ea25") : mobileT("mobile.ui.productshell.dab1726e45")}</Text></Pressable></View></View> : <Pressable accessibilityRole="button" onPress={() => setFinishReviewOpen(true)} style={styles.finishButton}><Text style={styles.finishButtonText}>{pending ? mobileT("mobile.ui.productshell.899f8ba261") : mobileT("mobile.ui.productshell.dda45d7e1a")}</Text></Pressable>}
      {managingUpcomingTasks ? <WorkoutTaskEditor application={application} userId={userId} workout={workout} onDismiss={() => setManagingUpcomingTasks(false)} onChanged={load} onRemoved={(task, index) => setRemovedTaskUndo({ task, index })} /> : null}
      {showSafetyPauseChoices ? <SafetyPauseChoices onDismiss={() => setShowSafetyPauseChoices(false)} onSelect={(signal) => void pauseForSafety(signal)} /> : null}
      {showSkipSet && pending ? <SkipCurrentSetSheet exerciseVariantId={pending.task.exerciseVariantId} onDismiss={() => setShowSkipSet(false)} onConfirm={(reason) => void skipCurrentSet(reason)} /> : null}
    </ScrollView>
  );
}

function WorkoutSetFlipCard({
  flipped,
  swipeEnabled,
  onSwipe,
  front,
  back,
}: {
  flipped: boolean;
  swipeEnabled: boolean;
  onSwipe: (direction: "previous" | "next") => void;
  front: React.ReactNode;
  back: React.ReactNode;
}) {
  const flip = useRef(new Animated.Value(flipped ? 1 : 0)).current;
  const translateX = useRef(new Animated.Value(0)).current;
  const height = useRef(new Animated.Value(280)).current;
  const [frontHeight, setFrontHeight] = useState(280);
  const [backHeight, setBackHeight] = useState(280);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(flip, {
        toValue: flipped ? 1 : 0,
        duration: 360,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(height, {
        toValue: flipped ? backHeight : frontHeight,
        duration: 240,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
    ]).start();
  }, [backHeight, flip, flipped, frontHeight, height]);

  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) => swipeEnabled
      && workoutHorizontalIntent(gesture.dx, gesture.dy, 18) !== "none",
    onPanResponderMove: (_event, gesture) => {
      translateX.setValue(Math.max(-96, Math.min(96, gesture.dx)));
    },
    onPanResponderRelease: (_event, gesture) => {
      const intent = workoutHorizontalIntent(gesture.dx, gesture.dy, 64);
      Animated.spring(translateX, { toValue: 0, useNativeDriver: true, speed: 24, bounciness: 4 }).start();
      if (intent !== "none") onSwipe(intent === "left" ? "next" : "previous");
    },
    onPanResponderTerminate: () => {
      Animated.spring(translateX, { toValue: 0, useNativeDriver: true, speed: 24, bounciness: 4 }).start();
    },
  }), [onSwipe, swipeEnabled, translateX]);

  const frontRotation = flip.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "180deg"] });
  const backRotation = flip.interpolate({ inputRange: [0, 1], outputRange: ["180deg", "360deg"] });
  return <Animated.View
    accessibilityActions={[{ name: "decrement", label: mobileT("mobile.ui.productshell.d8445d74c2") }, { name: "increment", label: mobileT("mobile.ui.productshell.691688e4f7") }]}
    onAccessibilityAction={(event) => onSwipe(event.nativeEvent.actionName === "increment" ? "next" : "previous")}
    style={[styles.workoutSetFlipStage, { height, transform: [{ translateX }] }]}
    {...panResponder.panHandlers}
  >
    <Animated.View
      accessibilityElementsHidden={flipped}
      importantForAccessibility={flipped ? "no-hide-descendants" : "auto"}
      pointerEvents={flipped ? "none" : "auto"}
      onLayout={(event) => setFrontHeight(Math.max(280, Math.ceil(event.nativeEvent.layout.height)))}
      style={[styles.currentSetCard, styles.workoutSetFlipFace, { transform: [{ perspective: 1100 }, { rotateY: frontRotation }] }]}
    >{front}</Animated.View>
    <Animated.View
      accessibilityElementsHidden={!flipped}
      importantForAccessibility={flipped ? "auto" : "no-hide-descendants"}
      pointerEvents={flipped ? "auto" : "none"}
      onLayout={(event) => setBackHeight(Math.max(280, Math.ceil(event.nativeEvent.layout.height)))}
      style={[styles.currentSetCard, styles.workoutSetFlipFace, { transform: [{ perspective: 1100 }, { rotateY: backRotation }] }]}
    >{back}</Animated.View>
  </Animated.View>;
}

function CompletedSetHistory({
  outcomes,
}: {
  outcomes: Awaited<ReturnType<LocalProductKernel["readWorkoutSession"]>>["setOutcomes"];
}) {
  return <View accessibilityLabel={mobileT("mobile.ui.productshell.c2fd726065")} style={styles.completedHistory}>{outcomes.map((outcome, index) => {
    const previous = outcomes[index - 1];
    const loadChange = outcome.actualLoad && previous?.actualLoad && outcome.actualLoad.unit === previous.actualLoad.unit
      ? outcome.actualLoad.value - previous.actualLoad.value
      : undefined;
    const repsChange = outcome.actualReps !== undefined && previous?.actualReps !== undefined
      ? outcome.actualReps - previous.actualReps
      : undefined;
    return <View key={outcome.id} style={styles.completedHistoryRow}><Text style={styles.completedHistoryIndex}>{index + 1}</Text><Text style={styles.completedHistoryDose}>{outcome.actualLoad ? `${outcome.actualLoad.value}${outcome.actualLoad.unit} × ` : ""}{outcome.actualReps ?? "—"}</Text><Text style={styles.completedHistoryDelta}>{index === 0 ? mobileT("mobile.ui.productshell.da3e6ee56b") : `${loadChange === undefined ? mobileT("mobile.ui.productshell.51fb74ffb6") : loadChange > 0 ? mobileT("mobile.ui.productshell.df935454fe", { value0: loadChange }) : loadChange < 0 ? mobileT("mobile.ui.productshell.e7a45746c4", { value0: Math.abs(loadChange) }) : mobileT("mobile.ui.productshell.0c92ee59ce")}${repsChange === undefined || repsChange === 0 ? "" : repsChange > 0 ? mobileT("mobile.ui.productshell.fc1cfa82ca", { value0: repsChange }) : mobileT("mobile.ui.productshell.a6f05c64f4", { value0: repsChange })}`}</Text></View>;
  })}</View>;
}

function SwipeRevealWorkoutTaskRow({
  removeEnabled,
  canMoveUp,
  canMoveDown,
  onConfirmRemove,
  onReorder,
  children,
}: {
  removeEnabled: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onConfirmRemove: () => void;
  onReorder: (direction: "up" | "down") => void;
  children: React.ReactNode;
}) {
  const translateX = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;
  const [revealed, setRevealed] = useState(false);
  const [reorderArmed, setReorderArmed] = useState(false);
  const settle = useCallback((open: boolean) => {
    setRevealed(open);
    Animated.spring(translateX, {
      toValue: open ? -96 : 0,
      useNativeDriver: true,
      speed: 24,
      bounciness: 2,
    }).start();
  }, [translateX]);
  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponderCapture: (_event, gesture) => workoutReorderIntent(gesture.dx, gesture.dy, reorderArmed, 10) !== "none",
    onMoveShouldSetPanResponder: (_event, gesture) => removeEnabled
      && !reorderArmed
      && workoutHorizontalIntent(gesture.dx, gesture.dy, 18) === "left",
    onPanResponderMove: (_event, gesture) => {
      if (reorderArmed) {
        translateY.setValue(Math.max(-64, Math.min(64, gesture.dy)));
        return;
      }
      translateX.setValue(Math.max(-108, Math.min(0, (revealed ? -96 : 0) + gesture.dx)));
    },
    onPanResponderRelease: (_event, gesture) => {
      if (reorderArmed) {
        const direction = workoutReorderIntent(gesture.dx, gesture.dy, true);
        if (direction === "up" && canMoveUp) onReorder("up");
        else if (direction === "down" && canMoveDown) onReorder("down");
        setReorderArmed(false);
        Animated.spring(translateY, { toValue: 0, useNativeDriver: true, speed: 24, bounciness: 2 }).start();
        return;
      }
      settle(workoutHorizontalIntent(gesture.dx, gesture.dy, 48) === "left" || revealed && gesture.dx < 36);
    },
    onPanResponderTerminate: () => {
      setReorderArmed(false);
      Animated.spring(translateY, { toValue: 0, useNativeDriver: true, speed: 24, bounciness: 2 }).start();
      settle(revealed);
    },
  }), [canMoveDown, canMoveUp, onReorder, removeEnabled, reorderArmed, revealed, settle, translateX, translateY]);
  return <View style={{ position: "relative", overflow: "hidden", borderRadius: radius.row }} {...panResponder.panHandlers}>
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={mobileT("mobile.ui.productshell.5e79e74c91")}
      accessibilityElementsHidden={!revealed}
      disabled={!revealed || !removeEnabled}
      onPress={onConfirmRemove}
      style={{ position: "absolute", top: 0, right: 0, bottom: 0, width: 96, backgroundColor: colors.terra, alignItems: "center", justifyContent: "center" }}
    ><Text style={{ color: colors.white, fontSize: 12, fontWeight: "900" }}>{mobileT("mobile.ui.productshell.050ff5c725")}</Text></Pressable>
    <Animated.View style={{ transform: [{ translateX }, { translateY }], opacity: reorderArmed ? 0.9 : 1 }}>{children}</Animated.View>
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={mobileT("mobile.ui.productshell.1daf50ffa1")}
      accessibilityHint={mobileT("mobile.ui.productshell.10cb9c746d")}
      delayLongPress={350}
      disabled={revealed || !canMoveUp && !canMoveDown}
      onLongPress={() => { settle(false); setReorderArmed(true); }}
      style={{ position: "absolute", right: 8, top: 8, width: 44, height: 44, borderRadius: 14, backgroundColor: colors.paper2, alignItems: "center", justifyContent: "center", opacity: revealed ? 0 : 1 }}
    ><Text style={{ color: colors.ink2, fontSize: 18, fontWeight: "900" }}>↕</Text></Pressable>
  </View>;
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
      setError(mobileT("mobile.ui.productshell.13efc7999d"));
      return;
    }
    onConfirm(value);
  };
  return <View accessibilityViewIsModal style={styles.safetyPauseScrim}>
    <Pressable accessibilityRole="button" accessibilityLabel={mobileT("mobile.ui.productshell.5db224ff85")} onPress={onDismiss} style={StyleSheet.absoluteFill} />
    <View style={styles.skipSetSheet}>
      <View style={styles.sheetHandle} />
      <Text style={styles.cardEyebrow}>{mobileT("mobile.ui.productshell.fd91ccd57f")}</Text>
      <Text style={styles.skipSetTitle}>{mobileT("mobile.ui.productshell.4ec952cb9a")}</Text>
      <Text style={styles.skipSetDetail}>{exerciseDisplayName(exerciseVariantId)} {mobileT("mobile.ui.productshell.d7f244c5f2")}</Text>
      <TextInput
        accessibilityLabel={mobileT("mobile.ui.productshell.d65271e962")}
        value={reason}
        onChangeText={(value) => { setReason(value); setError(undefined); }}
        placeholder={mobileT("mobile.ui.productshell.6114f81f53")}
        placeholderTextColor={colors.ink3}
        style={styles.skipSetInput}
        multiline
        maxLength={240}
      />
      {error ? <Text style={styles.formError}>{error}</Text> : null}
      <Pressable accessibilityRole="button" onPress={submit} style={styles.skipSetConfirm}><Text style={styles.skipSetConfirmText}>{mobileT("mobile.ui.productshell.dc7998d1d5")}</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={onDismiss} style={styles.safetyPauseCancel}><Text style={styles.safetyPauseCancelText}>{mobileT("mobile.ui.productshell.f5fe9e8ad4")}</Text></Pressable>
    </View>
  </View>;
}

function SafetyPauseChoices({ onDismiss, onSelect }: {
  onDismiss: () => void;
  onSelect: (signal: "new_sharp_pain" | "chest_discomfort" | "dizziness_or_fainting" | "unusual_breathing_difficulty" | "known_constraint") => void;
}) {
  const choices: readonly { signal: "new_sharp_pain" | "chest_discomfort" | "dizziness_or_fainting" | "unusual_breathing_difficulty" | "known_constraint"; label: string }[] = [
    { signal: "new_sharp_pain", label: mobileT("mobile.ui.productshell.6e6201f2e1") },
    { signal: "chest_discomfort", label: mobileT("mobile.ui.productshell.1c87dd6fd1") },
    { signal: "dizziness_or_fainting", label: mobileT("mobile.ui.productshell.5e44f89b91") },
    { signal: "unusual_breathing_difficulty", label: mobileT("mobile.ui.productshell.db0c33bff7") },
    { signal: "known_constraint", label: mobileT("mobile.ui.productshell.b30a975b18") },
  ];
  return <View accessibilityViewIsModal style={styles.safetyPauseScrim}>
    <Pressable accessibilityRole="button" accessibilityLabel={mobileT("mobile.ui.productshell.2ae3af30ba")} onPress={onDismiss} style={StyleSheet.absoluteFill} />
    <View style={styles.safetyPauseSheet}>
      <View style={styles.sheetHandle} />
      <Text style={styles.cardEyebrow}>{mobileT("mobile.ui.productshell.9692ba9c17")}</Text>
      <Text style={styles.safetyPauseTitle}>{mobileT("mobile.ui.productshell.8adfaf0672")}</Text>
      <Text style={styles.safetyPauseDetail}>{mobileT("mobile.ui.productshell.82e33a4a0c")}</Text>
      {choices.map((choice) => <Pressable key={choice.signal} accessibilityRole="button" onPress={() => onSelect(choice.signal)} style={styles.safetyPauseChoice}><Text style={styles.safetyPauseChoiceText}>{choice.label}</Text><Text style={styles.chevron}>›</Text></Pressable>)}
      <Pressable accessibilityRole="button" onPress={onDismiss} style={styles.safetyPauseCancel}><Text style={styles.safetyPauseCancelText}>{mobileT("mobile.ui.productshell.570554cecc")}</Text></Pressable>
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
  userId,
  workout,
  onDismiss,
  onChanged,
  onRemoved,
}: {
  application: LocalProductKernel;
  userId: string;
  workout: Awaited<ReturnType<LocalProductKernel["readWorkoutSession"]>>;
  onDismiss: () => void;
  onChanged: () => Promise<void> | void;
  onRemoved: (task: PlannedExerciseTask, index: number) => void;
}) {
  const [query, setQuery] = useState("");
  const [selectedTaskId, setSelectedTaskId] = useState<string>();
  const [selectedExerciseId, setSelectedExerciseId] = useState<string>();
  const [setCount, setSetCount] = useState("");
  const [targetValue, setTargetValue] = useState("");
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
    (task) => task.sets.some((set) => !completed.has(set.id)),
  );
  const candidates = application.searchExerciseCatalog({ query, limit: 6, purpose: "recommendation" });
  const selectedExercise = selectedExerciseId
    ? candidates.find((candidate) => candidate.id === selectedExerciseId) ??
      application.searchExerciseCatalog({ query: selectedExerciseId, limit: 1 })[0]
    : undefined;
  const commit = async (
    change: Parameters<LocalProductKernel["editUpcomingWorkoutPlan"]>[0]["change"],
    reason: string,
  ) => {
    setBusy(true);
    setSaveState("saving");
    try {
      const key = `mobile-workout:${workout.id}:task-edit:${workout.revision}:${change.kind}:${selectedTaskId ?? selectedExerciseId ?? "none"}`;
      await application.editUpcomingWorkoutPlan({ userId, workoutId: workout.id, change, reason, idempotencyKey: key });
      setError(undefined);
      setSaveState("idle");
      await onChanged();
      onDismiss();
      return true;
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : mobileT("mobile.ui.productshell.eb8e55bcec");
      const conflict = /conflict|revision/i.test(detail);
      setSaveState(conflict ? "conflict" : "failed");
      setError(conflict ? mobileT("mobile.ui.productshell.9cec27855f") : mobileT("mobile.ui.productshell.754d21d42c"));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const add = async () => {
    if (!selectedExercise) {
      setError(mobileT("mobile.ui.productshell.3471124484"));
      return;
    }
    const count = optionalFiniteNumber(setCount);
    const value = optionalFiniteNumber(targetValue);
    if (!count || !Number.isInteger(count) || count < 1 || count > 12) {
      setError(mobileT("mobile.ui.productshell.4256527303"));
      return;
    }
    if (value === undefined || value <= 0) {
      setError(mobileT("mobile.ui.productshell.99440016c2"));
      return;
    }
    const identity = selectedExercise.identity.loadMeasurement;
    if (identity === "none") {
      setError(mobileT("mobile.ui.productshell.6461639b3b"));
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
      setError(mobileT("mobile.ui.productshell.e995f5fe09"));
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
  const remove = async (task: PlannedExerciseTask, index: number) => {
    const removed = await commit(
      { kind: "remove_task", taskId: task.id },
      "user_removed_unstarted_task",
    );
    if (removed) onRemoved(task, index);
  };
  return (
    <View style={styles.exerciseManagerScrim}>
      <View style={styles.exerciseManagerSheet}>
        <View style={styles.sheetHandle} />
        <View style={styles.exerciseManagerHeader}>
          <View style={styles.exerciseManagerHeaderCopy}><Text style={styles.logTitle}>{mobileT("mobile.ui.productshell.db26286d9f")}</Text><Text style={styles.exerciseManagerSub}>{mobileT("mobile.ui.productshell.d03fb52b0d")}</Text></View>
          <Pressable accessibilityRole="button" accessibilityLabel={mobileT("mobile.ui.productshell.d2b4085e18")} onPress={onDismiss} style={styles.exerciseClose}><Text style={styles.exerciseCloseText}>{mobileT("mobile.ui.productshell.33246f6a5e")}</Text></Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.exerciseManagerScroll} keyboardShouldPersistTaps="handled">
          <Text style={styles.exerciseFieldLabel}>{mobileT("mobile.ui.productshell.434621d9fe")}</Text>
          {editableTasks.length ? editableTasks.map((task) => {
            const originalIndex = workout.frozenPrescription.tasks.findIndex((candidate) => candidate.id === task.id);
            const hasLockedSet = task.sets.some((set) => completed.has(set.id) || drafted.has(set.id));
            return <SwipeRevealWorkoutTaskRow
              key={task.id}
              removeEnabled={!busy && !hasLockedSet}
              canMoveUp={!busy && !hasLockedSet && originalIndex > 0}
              canMoveDown={!busy && !hasLockedSet && originalIndex < workout.frozenPrescription.tasks.length - 1}
              onConfirmRemove={() => void remove(task, originalIndex)}
              onReorder={(direction) => void commit({ kind: "reorder_task", taskId: task.id, toIndex: originalIndex + (direction === "up" ? -1 : 1) }, "user_dragged_unstarted_task")}
            >
              <View style={[styles.workoutTaskEditorRow, selectedTaskId === task.id && styles.workoutTaskEditorRowSelected]}>
                <Pressable accessibilityRole="radio" accessibilityState={{ selected: selectedTaskId === task.id }} onPress={() => setSelectedTaskId(task.id)} style={styles.workoutTaskEditorPrimary}><Text style={styles.workoutTaskTitle}>{exerciseDisplayName(task.exerciseVariantId)}</Text><Text style={styles.exerciseManagerSub}>{task.sets.length} {mobileT("mobile.ui.productshell.a91e97907e")}{hasLockedSet ? mobileT("mobile.ui.productshell.724b296b9e") : mobileT("mobile.ui.productshell.2202d70612")}</Text></Pressable>
                <View style={styles.workoutTaskEditorActions}>
                  <Pressable accessibilityRole="button" disabled={busy || hasLockedSet || originalIndex <= 0} onPress={() => void commit({ kind: "reorder_task", taskId: task.id, toIndex: originalIndex - 1 }, "user_reordered_unstarted_task")} style={styles.workoutTaskTiny}><Text style={styles.workoutTaskTinyText}>{mobileT("mobile.ui.productshell.8a0c839791")}</Text></Pressable>
                  <Pressable accessibilityRole="button" disabled={busy || hasLockedSet || originalIndex >= workout.frozenPrescription.tasks.length - 1} onPress={() => void commit({ kind: "reorder_task", taskId: task.id, toIndex: originalIndex + 1 }, "user_reordered_unstarted_task")} style={styles.workoutTaskTiny}><Text style={styles.workoutTaskTinyText}>{mobileT("mobile.ui.productshell.05c46fa3b7")}</Text></Pressable>
                </View>
              </View>
            </SwipeRevealWorkoutTaskRow>;
          }) : <Text style={styles.exerciseEmpty}>{mobileT("mobile.ui.productshell.f8e0116dbd")}</Text>}
          <View style={styles.workoutTaskPicker}>
            <Text style={styles.exerciseFieldLabel}>{mobileT("mobile.ui.productshell.9541ef28eb")}</Text>
            <TextInput accessibilityLabel={mobileT("mobile.ui.productshell.13d3cd6134")} value={query} onChangeText={setQuery} style={styles.logInput} placeholder={mobileT("mobile.ui.productshell.30b0565c91")} placeholderTextColor="#777971" />
            <View style={styles.workoutCatalogList}>{candidates.map((candidate) => <Pressable key={candidate.id} accessibilityRole="radio" accessibilityState={{ selected: selectedExerciseId === candidate.id }} onPress={() => setSelectedExerciseId(candidate.id)} style={[styles.workoutCatalogRow, selectedExerciseId === candidate.id && styles.workoutCatalogRowSelected]}><Text style={styles.exerciseRowTitle}>{candidate.displayName.zh}</Text><Text style={styles.exerciseManagerSub}>{candidate.identity.loadMeasurement === "time" ? mobileT("mobile.ui.productshell.3cacefc6aa") : candidate.identity.loadMeasurement === "distance" ? mobileT("mobile.ui.productshell.b3480678b6") : candidate.identity.loadMeasurement === "bodyweight_node" ? mobileT("mobile.ui.productshell.9f99f6bb83") : mobileT("mobile.ui.productshell.f0c21c3440")}</Text></Pressable>)}</View>
            {selectedExercise ? <Text style={styles.workoutTaskBoundary}>{mobileT("mobile.ui.productshell.9103e42b40")}</Text> : null}
            <View style={styles.workoutTaskAddFields}><LightNumberInput label={mobileT("mobile.ui.productshell.1a569fe919")} value={setCount} onChange={setSetCount} /><LightNumberInput label={selectedExercise?.identity.loadMeasurement === "time" ? mobileT("mobile.ui.productshell.eb6aaba1a1") : selectedExercise?.identity.loadMeasurement === "distance" ? mobileT("mobile.ui.productshell.ee7f305751") : mobileT("mobile.ui.productshell.d4a97e7577")} value={targetValue} onChange={setTargetValue} /></View>
            <View style={styles.workoutTaskButtons}><Pressable accessibilityRole="button" disabled={busy} onPress={() => void replace()} style={styles.workoutTaskSecondary}><Text style={styles.workoutTaskSecondaryText}>{mobileT("mobile.ui.productshell.f0424203c7")}</Text></Pressable><Pressable accessibilityRole="button" disabled={busy} onPress={() => void add()} style={[styles.logSave, styles.workoutTaskAddButton, busy && styles.primaryButtonDisabled]}><Text style={styles.logSaveText}>{mobileT("mobile.ui.productshell.87742d86fb")}</Text></Pressable></View>
          </View>
      {saveState === "saving" ? <Text style={styles.workoutTaskBoundary}>{mobileT("mobile.ui.productshell.62eccbb2a2")}</Text> : null}
      {error ? <Text style={styles.formError}>{error}</Text> : null}
        </ScrollView>
      </View>
    </View>
  );
}

function PausedWorkoutScreen({ application, userId, workoutId, reason, onFinished, onResumed }: { application: LocalProductKernel; userId: string; workoutId: string; reason?: "user" | "safety" | "background" | "schedule"; onFinished: () => void; onResumed: () => void }) {
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const resume = async () => {
    setBusy(true);
    try {
      const result = await application.resumeWorkoutSession({ userId, workoutId, acknowledgeSafetyPause: reason === "safety", idempotencyKey: `mobile-workout:${workoutId}:resume` });
      if (result.status === "partial_proposal") {
        setError(mobileT("mobile.ui.productshell.146e89e100"));
        return;
      }
      onResumed();
    } catch (cause) { setError(userFacingError(cause, mobileT("mobile.ui.productshell.f8eb3b7293"))); }
    finally { setBusy(false); }
  };
  const finishPartial = async () => {
    setBusy(true);
    try {
      await application.completeWorkoutSession({ userId, workoutId, status: "partial", idempotencyKey: `mobile-workout:${workoutId}:finish-paused` });
      onFinished();
    } catch (cause) { setError(userFacingError(cause, mobileT("mobile.ui.productshell.bccc45c859"))); }
    finally { setBusy(false); }
  };
  const title = reason === "safety" ? mobileT("mobile.ui.productshell.0df8cc75ac") : mobileT("mobile.ui.productshell.dc591a14ee");
  const detail = reason === "safety"
    ? mobileT("mobile.ui.productshell.cda81ae26a")
    : mobileT("mobile.ui.productshell.1f2b45649a");
  return <View style={styles.pausedPage}><View style={styles.pausedCard}><Text style={styles.cardEyebrow}>{mobileT("mobile.ui.productshell.dc591a14ee")}</Text><Text style={styles.pausedTitle}>{title}</Text><Text style={styles.pausedDetail}>{detail}</Text>{error ? <Text style={styles.formError}>{error}</Text> : null}<Pressable accessibilityRole="button" disabled={busy} onPress={() => void resume()} style={[styles.primaryButton, busy && styles.primaryButtonDisabled]}><Text style={styles.primaryButtonText}>{reason === "safety" ? mobileT("mobile.ui.productshell.104bce818d") : mobileT("mobile.ui.productshell.3166554c46")}</Text></Pressable><Pressable accessibilityRole="button" disabled={busy} onPress={() => void finishPartial()} style={styles.finishButton}><Text style={styles.finishButtonText}>{mobileT("mobile.ui.productshell.36d9bc620d")}</Text></Pressable></View></View>;
}

function ActualInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <View style={styles.actualField}><ProfessionalTermText text={label} style={styles.actualLabel} /><TextInput accessibilityLabel={mobileT("mobile.ui.productshell.70c3f439be", { value0: label })} keyboardType="decimal-pad" value={value} onChangeText={onChange} style={styles.actualInput} placeholder="—" placeholderTextColor="#777971" /></View>;
}

function LightNumberInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <View style={styles.workoutTaskNumberField}><Text style={styles.workoutTaskNumberLabel}>{label}</Text><TextInput accessibilityLabel={label} keyboardType="decimal-pad" value={value} onChangeText={onChange} style={styles.workoutTaskNumberInput} placeholder="—" placeholderTextColor="#777971" /></View>;
}

function PlanSession({ session, subdued = false }: { session: ProductSession; subdued?: boolean }) {
  return <View style={[styles.planSession, subdued && styles.planSessionSubdued]}><Text style={styles.planSessionDate}>{shortDate(session.scheduledFor)}</Text><View style={styles.planSessionBody}><Text style={styles.planSessionTitle}>{readablePlanSessionTitle(session.title)}</Text><Text style={styles.planSessionMeta}>{sessionMeta(session)}</Text></View><Text style={styles.chevron}>›</Text></View>;
}

function DetailedPlanSession({ session, subdued = false }: { session: ProductSession; subdued?: boolean }) {
  const rest = session.kind === "rest" || session.kind === "recovery" || session.taskCount === 0;
  if (rest) return <View style={[styles.committedRestDay, subdued && styles.planSessionSubdued]}><Text style={styles.committedRestDate}>{weekdayAndDate(session.scheduledFor)}</Text><Text style={styles.committedRestTitle}>{mobileT("mobile.ui.productshell.c902062a8f")}</Text><Text style={styles.committedRestMeta}>{mobileT("mobile.ui.productshell.937232390d")}</Text></View>;
  return <View style={[styles.reportSessionCard, subdued && styles.planSessionSubdued]}>
    <View style={styles.reportSessionTop}><View><Text style={styles.reportSessionDate}>{weekdayAndDate(session.scheduledFor)}</Text><Text style={styles.reportSessionTitle}>{readablePlanSessionTitle(session.title)}</Text></View><Text style={styles.committedSessionSets}>{session.totalSetCount} {mobileT("mobile.ui.productshell.726ff2fac5")}</Text></View>
    <View style={styles.reportTaskList}>{session.actions.map((task) => <View key={task.id} style={styles.reportTaskRow}><View style={styles.reportTaskBullet} /><Text numberOfLines={1} style={styles.reportTaskName}>{humanizeExerciseLabel(task.label)}</Text><Text style={styles.reportTaskDose}>{humanizeDoseSummary(task.summary)}{task.targetRir !== undefined ? mobileT("mobile.ui.productshell.73ac72549d", { value0: task.targetRir }) : ""}</Text></View>)}</View>
    {session.aerobicBlock ? <View style={styles.reportAerobicBlock}><Text style={styles.reportAerobicTitle}>{session.aerobicBlock.placement === "after_strength" ? mobileT("mobile.ui.productshell.0cf5fd6711") : mobileT("mobile.ui.productshell.51d825bcd4")} · {session.aerobicBlock.minutes} {mobileT("mobile.ui.productshell.28bf227b9b")}</Text><ProfessionalTermText text={`RPE ${session.aerobicBlock.targetRpe.min}–${session.aerobicBlock.targetRpe.max} · ${session.aerobicBlock.talkTest} ${session.aerobicBlock.fastedEligible ? mobileT("mobile.ui.productshell.a26d533454") : mobileT("mobile.ui.productshell.906178ac62")}`} style={styles.reportAerobicCopy} />{session.aerobicBlock.safetyNote ? <Text style={styles.reportAerobicGuard}>{session.aerobicBlock.safetyNote}</Text> : null}</View> : null}
    <Text style={styles.reportSessionFoot}>{session.estimatedMinutes ? mobileT("mobile.ui.productshell.744a71c057", { value0: session.estimatedMinutes }) : mobileT("mobile.ui.productshell.9d7e88acce")} {mobileT("mobile.ui.productshell.8bf0c039bb")}</Text>
  </View>;
}

function Metric({ value, label }: { value: string; label: string }) { return <View style={styles.metric}><Text style={styles.metricValue}>{value || "—"}</Text><Text style={styles.metricLabel}>{label}</Text></View>; }
function ProfileRow({ label, value }: { label: string; value: string }) { return <View style={styles.profileRow}><Text style={styles.profileLabel}>{label}</Text><Text style={styles.profileValue}>{value}</Text></View>; }
function CoachPending({ prompt }: { prompt: string }) { return <View style={styles.pendingCard}><Text style={styles.pendingLabel}>{mobileT("mobile.ui.productshell.25a45621ed")}</Text><Text style={styles.pendingText}>{prompt}</Text></View>; }
function Empty({ label, compact = false }: { label: string; compact?: boolean }) { return <View style={[styles.empty, compact && styles.emptyCompact]}><Text style={styles.emptyText}>{label}</Text></View>; }
function LoadingState() { return <View style={styles.statePage}><ActivityIndicator color={colors.limeDeep} /><Text style={styles.stateText}>{mobileT("mobile.ui.productshell.73c362ad6d")}</Text></View>; }
function ErrorState({ message, onRetry, title = mobileT("mobile.ui.productshell.a8013df8d6"), retryLabel = mobileT("mobile.ui.productshell.e2d53a6d3a") }: { message: string; onRetry: () => void; title?: string; retryLabel?: string }) { return <View style={styles.statePage}><Text style={styles.stateTitle}>{title}</Text><Text style={styles.stateText}>{message}</Text><Pressable accessibilityRole="button" onPress={onRetry} style={styles.retry}><Text style={styles.retryText}>{retryLabel}</Text></Pressable></View>; }

function localDate(): string { return new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10); }
function isProductDeepLinkRoute(route: ProductRoute): route is ProductDeepLinkRoute {
  return route === "today" || route === "calendar" || route === "plan" || route === "profile" || route === "workout";
}
function isPrimaryProductRoute(route: string): route is PrimaryProductRoute {
  return route === "today" || route === "calendar" || route === "plan" || route === "profile";
}
function shiftCalendarDate(date: string, days: number): string { const next = new Date(`${date}T12:00:00.000Z`); next.setUTCDate(next.getUTCDate() + days); return next.toISOString().slice(0, 10); }
function shiftCalendarMonth(date: string, months: number): string { const [year, month, day] = date.split("-").map(Number); const first = new Date(Date.UTC(year!, month! - 1 + months, 1, 12)); const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate(); first.setUTCDate(Math.min(day!, lastDay)); return first.toISOString().slice(0, 10); }
function shortDate(date: string): string { const [, month, day] = date.split("-"); return mobileT("mobile.ui.productshell.b65c525564", { value0: Number(month), value1: Number(day) }); }
function localDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (part: number) => String(part).padStart(2, "0");
  return mobileT("mobile.ui.productshell.58c84df909", { value0: date.getMonth() + 1, value1: date.getDate(), value2: pad(date.getHours()), value3: pad(date.getMinutes()) });
}
function sessionMeta(session: ProductSession): string { return `${session.kind === "cardio" ? mobileT("mobile.ui.productshell.25b132283f") : session.kind === "rest" || session.kind === "recovery" ? mobileT("mobile.ui.productshell.79748ca1c6") : mobileT("mobile.ui.productshell.796e01d5af")}${session.estimatedMinutes ? mobileT("mobile.ui.productshell.7c633644b1", { value0: session.estimatedMinutes }) : ""}${session.taskCount ? mobileT("mobile.ui.productshell.a11fcc6073", { value0: session.taskCount }) : ""}`; }
function weekdayAndDate(date: string): string { const weekday = [mobileT("mobile.ui.productshell.c3405710e0"), mobileT("mobile.ui.productshell.792c34e70d"), mobileT("mobile.ui.productshell.8f03441d4b"), mobileT("mobile.ui.productshell.254556737b"), mobileT("mobile.ui.productshell.18f1fd9e88"), mobileT("mobile.ui.productshell.4344fc1363"), mobileT("mobile.ui.productshell.f0c6199aa0")][new Date(`${date}T12:00:00.000Z`).getUTCDay()]; return `${weekday} · ${shortDate(date)}`; }
function readablePlanSessionTitle(title: string): string { return title.replace("hypertrophy", mobileT("mobile.ui.productshell.5ea5b92ec0")).replace("strength", mobileT("mobile.ui.productshell.043b41ab7d")).replace("fat_loss_preserve_lean_mass", mobileT("mobile.ui.productshell.18c4940da9")); }
function humanizeExerciseLabel(label: string): string {
  const tokenLabels: Record<string, string> = {
    band: mobileT("mobile.ui.productshell.55c300f60d"),
    barbell: mobileT("mobile.ui.productshell.18411deb8a"),
    bodyweight: mobileT("mobile.ui.productshell.9f99f6bb83"),
    cable: mobileT("mobile.ui.productshell.7befd27dda"),
    cardio_machine: mobileT("mobile.ui.productshell.48bced69af"),
    dumbbell: mobileT("mobile.ui.productshell.eab45346b2"),
    kettlebell: mobileT("mobile.ui.productshell.2c7701669d"),
    machine: mobileT("mobile.ui.productshell.afdbbba4b3"),
    none: mobileT("mobile.ui.productshell.aa41b3943c"),
    conventional: mobileT("mobile.ui.productshell.7383d54675"),
    breathing: mobileT("mobile.ui.productshell.5fd964d0e6"),
    body_saw: mobileT("mobile.ui.productshell.31fc2fe63e"),
    brisk: mobileT("mobile.ui.productshell.804d9d8064"),
    ankle: mobileT("mobile.ui.productshell.e31bbf9fa9"),
    incline: mobileT("mobile.ui.productshell.d1f0722062"),
    decline: mobileT("mobile.ui.productshell.6f02571a23"),
    easy: mobileT("mobile.ui.productshell.c9c4a72eeb"),
    easy_walk: mobileT("mobile.ui.productshell.0c938ddc18"),
    elbow_at_side: mobileT("mobile.ui.productshell.54022dc63e"),
    forward: mobileT("mobile.ui.productshell.5987f408dd"),
    full_body: mobileT("mobile.ui.productshell.15598fb229"),
    gentle_stretch: mobileT("mobile.ui.productshell.16a5c06d3c"),
    half_kneeling: mobileT("mobile.ui.productshell.cddf3ae88a"),
    hip: mobileT("mobile.ui.productshell.b6cb35f15f"),
    in_place: mobileT("mobile.ui.productshell.b7daa85402"),
    interval: mobileT("mobile.ui.productshell.a25e603f78"),
    knee: mobileT("mobile.ui.productshell.e4861197d9"),
    knee_raise: mobileT("mobile.ui.productshell.9850eb8e5f"),
    kneeling: mobileT("mobile.ui.productshell.0fd17308e3"),
    lateral: mobileT("mobile.ui.productshell.692bc6a06a"),
    lean_away: mobileT("mobile.ui.productshell.f6f44b7382"),
    long_lever: mobileT("mobile.ui.productshell.c0275273de"),
    lying: mobileT("mobile.ui.productshell.5e90e45d44"),
    ninety_degree: mobileT("mobile.ui.productshell.df0f1517ce"),
    overhead: mobileT("mobile.ui.productshell.e0464e6eb7"),
    paused: mobileT("mobile.ui.productshell.92ef1c79c3"),
    pushdown: mobileT("mobile.ui.productshell.1e8cd56ec0"),
    recumbent: mobileT("mobile.ui.productshell.8f69b444d0"),
    rear_foot_elevated: mobileT("mobile.ui.productshell.b7fe54ea9a"),
    reverse: mobileT("mobile.ui.productshell.e3a96490b3"),
    rest: mobileT("mobile.ui.productshell.da11d57634"),
    rope: mobileT("mobile.ui.productshell.e91a55a873"),
    romanian: mobileT("mobile.ui.productshell.ddfb62c7b6"),
    seated: mobileT("mobile.ui.productshell.1a23b8e788"),
    side_left: mobileT("mobile.ui.productshell.440495fc2d"),
    side_right: mobileT("mobile.ui.productshell.1e4e7a177d"),
    spin: mobileT("mobile.ui.productshell.911b6382af"),
    steady: mobileT("mobile.ui.productshell.9a5e166372"),
    standing: mobileT("mobile.ui.productshell.2f953f98f4"),
    step_jack: mobileT("mobile.ui.productshell.75c6655a28"),
    shoulder: mobileT("mobile.ui.productshell.0e302421dd"),
    thoracic: mobileT("mobile.ui.productshell.3e332764a8"),
    walking: mobileT("mobile.ui.productshell.2418916d1f"),
    wrist: mobileT("mobile.ui.productshell.408488fbee"),
    upright: mobileT("mobile.ui.productshell.613ea3ec83"),
  };
  return label
    .split(" · ")
    .filter((token) => token !== "standard")
    .map((token) => tokenLabels[token] ?? token)
    .join(" · ");
}
function humanizeDoseSummary(summary: string): string {
  return summary
    .replace(/\bminutes?\b/g, mobileT("mobile.ui.productshell.28bf227b9b"))
    .replace(/\bseconds?\b/g, mobileT("mobile.ui.productshell.eb6aaba1a1"))
    .replace(/\bhours?\b/g, mobileT("mobile.ui.productshell.99f6904ff3"))
    .replace(/\breps?\b/g, mobileT("mobile.ui.productshell.5e5b8169ee"));
}
function exerciseDisplayName(id: string): string {
  const prefix = id.split(".")[0];
  return ({
    anti_rotation_press: mobileT("mobile.ui.productshell.0ab6e93212"),
    bench_press: mobileT("mobile.ui.productshell.3e3510f68d"),
    biceps_curl: mobileT("mobile.ui.productshell.87547c94af"),
    calf_raise: mobileT("mobile.ui.productshell.fe47ccd518"),
    chest_fly: mobileT("mobile.ui.productshell.20f45492d1"),
    crunch: mobileT("mobile.ui.productshell.cb73c1a749"),
    cycle: mobileT("mobile.ui.productshell.596c5a92ea"),
    deadlift: mobileT("mobile.ui.productshell.1e54cd433c"),
    elliptical: mobileT("mobile.ui.productshell.97cd453e1a"),
    external_rotation: mobileT("mobile.ui.productshell.31fbc2cc00"),
    front_raise: mobileT("mobile.ui.productshell.7b337ab1df"),
    hip_thrust: mobileT("mobile.ui.productshell.55d33807cc"),
    knee_extension: mobileT("mobile.ui.productshell.677bd71c0c"),
    knee_flexion: mobileT("mobile.ui.productshell.520aa50d31"),
    lat_pulldown: mobileT("mobile.ui.productshell.c28855ee30"),
    lateral_raise: mobileT("mobile.ui.productshell.71105cb874"),
    leg_press: mobileT("mobile.ui.productshell.2e5b0b61f2"),
    lunge: mobileT("mobile.ui.productshell.67b8955983"),
    march: mobileT("mobile.ui.productshell.be74831776"),
    mobility_flow: mobileT("mobile.ui.productshell.af1ec9647e"),
    overhead_press: mobileT("mobile.ui.productshell.7251c03894"),
    plank: mobileT("mobile.ui.productshell.96d9004303"),
    push_up: mobileT("mobile.ui.productshell.d6901dd1e8"),
    pull_up: mobileT("mobile.ui.productshell.967c0d3aac"),
    rear_delt_fly: mobileT("mobile.ui.productshell.bfac05ce8b"),
    recovery_activity: mobileT("mobile.ui.productshell.2cbdae07ce"),
    row: mobileT("mobile.ui.productshell.3febe8cf8d"),
    split_squat: mobileT("mobile.ui.productshell.78f50f3835"),
    inverted_row: mobileT("mobile.ui.productshell.0ce2b2714c"),
    squat: mobileT("mobile.ui.productshell.892fd5fbd9"),
    stair_climb: mobileT("mobile.ui.productshell.286c460906"),
    straight_arm_pulldown: mobileT("mobile.ui.productshell.027661e045"),
    triceps_extension: mobileT("mobile.ui.productshell.d187fc6670"),
    walk: mobileT("mobile.ui.productshell.191f5b40d1"),
    romanian_deadlift: mobileT("mobile.ui.productshell.9043995a63"),
    shoulder_press: mobileT("mobile.ui.productshell.7251c03894"),
  } as Record<string, string>)[prefix] ?? id.replace(/[._-]+/g, " ");
}
function planTaskDose(task: import("../../coach/domain").PlannedExerciseTask): string {
  const first = task.sets[0];
  if (!first) return mobileT("mobile.ui.productshell.71e93e636f");
  const target = first.targetReps
    ? mobileT("mobile.ui.productshell.ddd97d4b7a", { value0: first.targetReps.min === first.targetReps.max ? first.targetReps.min : `${first.targetReps.min}–${first.targetReps.max}` })
    : first.targetDuration
      ? `${first.targetDuration.value} ${first.targetDuration.unit === "seconds" ? mobileT("mobile.ui.productshell.eb6aaba1a1") : first.targetDuration.unit === "minutes" ? mobileT("mobile.ui.productshell.28bf227b9b") : mobileT("mobile.ui.productshell.99f6904ff3")}`
      : first.targetDistance
        ? `${first.targetDistance.value} ${first.targetDistance.unit}`
        : mobileT("mobile.ui.productshell.71e93e636f");
  const rest = first.rest
    ? first.rest.unit === "seconds"
      ? mobileT("mobile.ui.productshell.e4b5ab2535", { value0: first.rest.value })
      : mobileT("mobile.ui.productshell.b16f805a29", { value0: first.rest.value })
    : undefined;
  return `${task.sets.length} × ${target}${first.targetRir !== undefined ? mobileT("mobile.ui.productshell.8b9ce18b64", { value0: first.targetRir }) : ""}${rest ? mobileT("mobile.ui.productshell.9240234c39", { value0: rest }) : ""}`;
}
function outcomeStatusLabel(status: WorkoutOutcomeProductSummary["status"]): string { return status === "completed" ? mobileT("mobile.ui.productshell.e99b48a29b") : status === "partial" ? mobileT("mobile.ui.productshell.5395180221") : mobileT("mobile.ui.productshell.5c174784ba"); }
function outcomeCompletenessLabel(value: WorkoutOutcomeProductSummary["dataCompleteness"]): string { return value === "complete" ? mobileT("mobile.ui.productshell.66ead22926") : value === "partial" ? mobileT("mobile.ui.productshell.acb47b3ad7") : mobileT("mobile.ui.productshell.d98299e6c4"); }
function trendValue(value: number | undefined, unit: string | undefined): string { return value === undefined ? "—" : `${value.toFixed(1)}${unit === "percent" ? "%" : unit ?? ""}`; }
function trendCoverage(count: number | undefined): string { return count ? mobileT("mobile.ui.productshell.193c00e1d7", { value0: count }) : mobileT("mobile.ui.productshell.d4ddd5191e"); }
function metricLabel(name: string): string { return { body_trend: mobileT("mobile.ui.productshell.f27012ee66"), training_trend: mobileT("mobile.ui.productshell.c60b8441ed"), nutrition_adherence: mobileT("mobile.ui.productshell.437ccd29f9"), recovery_trend: mobileT("mobile.ui.productshell.a18ec79a53"), phase_progress: mobileT("mobile.ui.productshell.3f997371e4"), goal_feasibility: mobileT("mobile.ui.productshell.894788593b") }[name] ?? name; }
function metricDirectionLabel(direction: string, score?: number): string { if (direction === "improving") return score === undefined ? mobileT("mobile.ui.productshell.f59bd9e46e") : mobileT("mobile.ui.productshell.2e03207ef0", { value0: score.toFixed(2) }); if (direction === "declining") return score === undefined ? mobileT("mobile.ui.productshell.36485c37a3") : mobileT("mobile.ui.productshell.7a5073dcca", { value0: Math.abs(score).toFixed(2) }); if (direction === "stable") return mobileT("mobile.ui.productshell.4024bd5e23"); return mobileT("mobile.ui.productshell.06b938781d"); }
function metricConfidenceLabel(confidence: string): string { return confidence === "high" ? mobileT("mobile.ui.productshell.8683dd012a") : confidence === "moderate" ? mobileT("mobile.ui.productshell.6b303a2562") : mobileT("mobile.ui.productshell.31c33fa3d4"); }
type LedgerIntakeStatus = "unknown" | "partial" | "below" | "on_track" | "over";
function nutritionDayKindLabel(kind: DailyHealthLedger["nutritionPlan"]["dayKind"]): string { return kind === "training" ? mobileT("mobile.ui.productshell.132d15591f") : kind === "rest" ? mobileT("mobile.ui.productshell.743a4ad0dd") : kind === "deload" ? mobileT("mobile.ui.productshell.1e370de3e6") : kind === "recovery" ? mobileT("mobile.ui.productshell.7369b4b9a3") : mobileT("mobile.ui.productshell.c4f64b5c3c"); }
function ledgerTargetKcal(ledger: DailyHealthLedger): number | undefined { return ledger.nutritionPlan.targets.energy.value; }
function ledgerConsumedKcal(ledger: DailyHealthLedger): number | undefined { const value = ledger.nutrition.nutrients.energy; return value.reportedValueCount ? Math.round(value.consumedLogged) : undefined; }
function ledgerProgressRatio(ledger: DailyHealthLedger): number | undefined { const target = ledgerTargetKcal(ledger); const consumed = ledgerConsumedKcal(ledger); return ledger.nutrition.nutrients.energy.intakeKnown && target && consumed !== undefined ? consumed / target : undefined; }
function ledgerVariancePercent(ledger: DailyHealthLedger): number | undefined { const ratio = ledgerProgressRatio(ledger); return ratio === undefined ? undefined : Math.round((ratio - 1) * 100); }
function ledgerIntakeStatus(ledger: DailyHealthLedger): LedgerIntakeStatus { const variance = ledgerVariancePercent(ledger); if (ledger.nutrition.coverage === "no_log") return "unknown"; if (variance === undefined) return "partial"; if (variance < -10) return "below"; if (variance > 10) return "over"; return "on_track"; }
function intakePalette(status: LedgerIntakeStatus): { color: string; soft: string; ink: string } {
  if (status === "on_track") return { color: colors.fuelSafe, soft: colors.fuelSafeSoft, ink: "#476D0C" };
  if (status === "below" || status === "partial") return { color: colors.fuelWarn, soft: colors.fuelWarnSoft, ink: "#805500" };
  if (status === "over") return { color: colors.fuelDanger, soft: colors.fuelDangerSoft, ink: "#9F2B20" };
  return { color: colors.ink3, soft: colors.paper2, ink: colors.ink2 };
}
function intakeStatusLabel(budget: DailyHealthLedger): string {
  const status = ledgerIntakeStatus(budget);
  if (status === "unknown") return mobileT("mobile.ui.productshell.78081971e6");
  if (status === "partial") return "记录不完整";
  if (status === "on_track") return mobileT("mobile.ui.productshell.cc88ccd29d");
  const variance = ledgerVariancePercent(budget) ?? 0;
  return variance < 0 ? mobileT("mobile.ui.productshell.7f9939a39b", { value0: Math.abs(variance) }) : mobileT("mobile.ui.productshell.095a33e0a7", { value0: variance });
}
function intakeExplanation(budget: DailyHealthLedger): { title: string; body: string } {
  const status = ledgerIntakeStatus(budget);
  const magnitude = Math.abs(ledgerVariancePercent(budget) ?? 0);
  if (status === "unknown" || status === "partial") {
    const partial = status === "partial";
    return {
      title: partial ? mobileT("mobile.ui.productshell.5e5609966d") : mobileT("mobile.ui.productshell.fe531eb587"),
      body: partial ? mobileT("mobile.ui.productshell.5ff22e2e1c") : mobileT("mobile.ui.productshell.5aa6bc588c"),
    };
  }
  if (status === "below") return { title: mobileT("mobile.ui.productshell.1a649f84d2", { value0: magnitude }), body: mobileT("mobile.ui.productshell.e0d4f039c3") };
  if (status === "on_track") return { title: mobileT("mobile.ui.productshell.e448b9a13c"), body: mobileT("mobile.ui.productshell.5c6819f820") };
  return { title: mobileT("mobile.ui.productshell.cd4d0f8b1b", { value0: magnitude }), body: mobileT("mobile.ui.productshell.c0eac9fdf5") };
}
function intakeAdjustmentSummary(budget: DailyHealthLedger): string {
  if (budget.energyBalance.status !== "complete") return budget.nutrition.coverage === "partial" ? "记录不完整，暂不判断热量差" : mobileT("mobile.ui.productshell.75600fba2c");
  return `热量差 ${signedKcal(Math.round((budget.energyBalance.range.min + budget.energyBalance.range.max) / 2))}`;
}
function signedKcal(value: number): string { return `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toLocaleString()} kcal`; }
function weekDayLabel(date: string): string { return [mobileT("mobile.ui.productshell.c3405710e0"), mobileT("mobile.ui.productshell.792c34e70d"), mobileT("mobile.ui.productshell.8f03441d4b"), mobileT("mobile.ui.productshell.254556737b"), mobileT("mobile.ui.productshell.18f1fd9e88"), mobileT("mobile.ui.productshell.4344fc1363"), mobileT("mobile.ui.productshell.f0c6199aa0")][new Date(`${date}T12:00:00.000Z`).getUTCDay()] ?? ""; }
function dateDistance(from: string, to: string): number { return Math.round((Date.parse(`${to}T12:00:00.000Z`) - Date.parse(`${from}T12:00:00.000Z`)) / 86_400_000); }
function recoveryLevelLabel(level: CoachProductProjection["today"]["recovery"]["level"]): string { return level === "normal" ? mobileT("mobile.ui.productshell.c177e6ac8c") : level === "slight_reduction" ? mobileT("mobile.ui.productshell.e921a3c856") : level === "recovery_priority" ? mobileT("mobile.ui.productshell.be7c927520") : mobileT("mobile.ui.productshell.ce4faf591f"); }
function clampNumber(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)); }
function goalLabel(value?: string): string {
  if (value === "hypertrophy") return mobileT("mobile.ui.productshell.5ea5b92ec0");
  if (value === "strength") return mobileT("mobile.ui.productshell.e73fa7ffe3");
  if (value === "fat_loss_preserve_lean_mass") return mobileT("mobile.ui.productshell.18c4940da9");
  if (value === "physique") return mobileT("mobile.ui.productshell.goal.physique");
  if (value === "maintain") return mobileT("mobile.ui.productshell.goal.maintain");
  if (value === "return_to_training") return mobileT("mobile.ui.productshell.goal.returnToTraining");
  return mobileT("mobile.ui.productshell.7c8d65e331");
}
function recoveryReasonLabel(value: string, locale?: string): string {
  return ({
    no_active_recovery_constraint: mobileT("mobile.ui.productshell.c8ef1034e0"),
    check_in_optional: mobileT("mobile.ui.productshell.b6426caf17"),
    recovery_check_in_missing: mobileT("mobile.ui.productshell.ff422dd442"),
    sleep_missing: mobileT("mobile.ui.productshell.a1437ff08c"),
  } as Record<string, string>)[value] ?? planningPhrase(value, locale).replaceAll("_", " ");
}
function movementLabel(value?: MovementPattern): string { return movementChoices.find((choice) => choice.value === value)?.label ?? mobileT("mobile.ui.productshell.b28f13ea3e"); }
function permissionLabel(value: string): string { return value === "granted" ? mobileT("mobile.ui.productshell.3dec7f67ef") : value === "denied" ? mobileT("mobile.ui.productshell.3cbefc6e34") : mobileT("mobile.ui.productshell.55a04b58cd"); }
function planAuthorizationLabel(value: NonNullable<import("../../coach/domain").CoachingMandateData["planChangeAuthorization"]>): string {
  return ({ ask_this_time: "本次询问", always_ask: "每次询问", allow_once: "允许一次小调整", allow_similar_small: "允许同类小调整", deny: "不允许自动调整" } as const)[value];
}
function privacyAccountLabel(_overview: PrivacySettingsOverviewValue): string {
  return mobileT("mobile.ui.productshell.3eacabd81c");
}
function privacyAccountDetail(_overview: PrivacySettingsOverviewValue): string {
  return mobileT("mobile.ui.productshell.edff115a3a");
}
function privacyRemoteModelLabel(overview: PrivacySettingsOverviewValue): string {
  return overview.remoteModel.configuration.status === "managed_cloud" ? mobileT("mobile.ui.productshell.25d2843150") : mobileT("mobile.ui.productshell.beff4a1cd1");
}
function healthSourceLabel(platform: CoachProductProjection["profile"]["healthSources"][number]["platform"]): string { return platform === "health_connect" ? "Health Connect" : platform === "healthkit" ? mobileT("mobile.ui.productshell.6de270c4a7") : mobileT("mobile.ui.productshell.2f360ef59d"); }
function healthSourceSummary(source: CoachProductProjection["profile"]["healthSources"][number]): string {
  const sourceName = healthSourceLabel(source.platform);
  if (source.availability !== "available") {
    return source.availability === "provider_missing_or_update_required" ? mobileT("mobile.ui.productshell.4eec435747", { value0: sourceName }) :
      source.availability === "not_supported" ? mobileT("mobile.ui.productshell.1302dcfcb8", { value0: sourceName }) :
      source.availability === "permission_not_requested" ? mobileT("mobile.ui.productshell.40b1a25060") :
      source.availability === "permission_denied_or_revoked" ? mobileT("mobile.ui.productshell.1be54e90a5") :
      source.availability === "temporarily_unavailable" ? mobileT("mobile.ui.productshell.f11b856457") : mobileT("mobile.ui.productshell.1b8b025470");
  }
  const granted = source.grantedMetricTypes.length;
  const unknown = source.unknownPermissionMetricTypes.length;
  const metricText = unknown
    ? mobileT("mobile.ui.productshell.1524bd15ef", { value0: unknown, value1: source.metricTypes.length })
    : mobileT("mobile.ui.productshell.288674ff99", { value0: granted, value1: source.metricTypes.length });
  const importedAt = source.lastSuccessfulImportAt ?? source.lastAttemptAt;
  return `${metricText} · ${importedAt.slice(5, 16)}`;
}
function healthConnectionStatus(availability: import("../../coach/model").HealthAdapterAvailability, granted: number, sourceName: string): string {
  if (availability === "available") return granted ? mobileT("mobile.ui.productshell.b4b5e13ae3", { value0: granted }) : mobileT("mobile.ui.productshell.c3fe7f3557");
  if (availability === "provider_missing_or_update_required") return mobileT("mobile.ui.productshell.4eec435747", { value0: sourceName });
  if (availability === "not_supported") return mobileT("mobile.ui.productshell.1302dcfcb8", { value0: sourceName });
  if (availability === "permission_not_requested") return mobileT("mobile.ui.productshell.40df696003");
  if (availability === "permission_denied_or_revoked") return mobileT("mobile.ui.productshell.afb788da15");
  if (availability === "temporarily_unavailable") return mobileT("mobile.ui.productshell.4150381383");
  return mobileT("mobile.ui.productshell.21d4e02175");
}
function actionLabel(action: CoachProductProjection["profile"]["actionLog"]["recent"][number]["action"]): string { return action === "plan.change.applied" ? mobileT("mobile.ui.productshell.9db8fc01fc") : action === "plan.change.undone" ? mobileT("mobile.ui.productshell.0469cebd74") : action === "plan.change.rejected" ? mobileT("mobile.ui.productshell.ea6ec2eed0") : action === "plan.change.ignored" ? mobileT("mobile.ui.productshell.9f92616234") : action === "proposal.created" ? mobileT("mobile.ui.productshell.28ec7c5625") : action === "assessment.created" ? mobileT("mobile.ui.productshell.45980bd4d0") : action === "fact.written" ? mobileT("mobile.ui.productshell.c94c4d8600") : action === "timeline.corrected" ? mobileT("mobile.ui.productshell.2ca4f20b5c") : action === "workout.corrected" ? mobileT("mobile.ui.productshell.5790351403") : action === "workout.set_skipped" ? mobileT("mobile.ui.productshell.2f3901d777") : action === "memory.changed" ? mobileT("mobile.ui.productshell.eb4b6cc0eb") : action === "permission.changed" ? mobileT("mobile.ui.productshell.ccb6dce6c0") : mobileT("mobile.ui.productshell.752398909f"); }
function actionResultLabel(result: CoachProductProjection["profile"]["actionLog"]["recent"][number]["result"]): string { return result === "applied" ? mobileT("mobile.ui.productshell.ab1f366cb0") : result === "undone" ? mobileT("mobile.ui.productshell.61063ba81b") : result === "rejected" ? mobileT("mobile.ui.productshell.4c7c52c706") : result === "allowed" ? mobileT("mobile.ui.productshell.d94731eaa9") : mobileT("mobile.ui.productshell.b61b08aec3"); }
function strategyLabel(strategy: string): string { return ({ fat_loss_recomposition: mobileT("mobile.ui.productshell.f6d6eefcbf"), preserve_lean_mass_cut: mobileT("mobile.ui.productshell.821ac906e3"), final_cut: mobileT("mobile.ui.productshell.27ab18ed67"), maintenance_recomposition: mobileT("mobile.ui.productshell.28553b6e2e"), recovery_maintenance: mobileT("mobile.ui.productshell.0d0f8629d8"), conservative_gain: mobileT("mobile.ui.productshell.1f7069e914"), stable_strength_gain: mobileT("mobile.ui.productshell.c0124b2ad5"), return_to_training: mobileT("mobile.ui.productshell.3bf5cc2440"), advanced_specialization_maintenance: mobileT("mobile.ui.productshell.e0692359d1"), post_loss_consolidation_gain: mobileT("mobile.ui.productshell.7ac2368587"), diet_break: "Diet break", deload_overlay: "Deload" } as Record<string, string>)[strategy] ?? strategy; }
function forecastScenarioLabel(scenario: "strict_aggressive" | "balanced" | "flexible"): string { return scenario === "strict_aggressive" ? mobileT("mobile.ui.productshell.9da8303c79") : scenario === "balanced" ? mobileT("mobile.ui.productshell.d86368eac0") : mobileT("mobile.ui.productshell.3c2ab9e4c7"); }
function actorLabel(actor: "user" | "agent" | "rule_engine" | "sensor" | "sync"): string { return actor === "agent" ? "Coach" : actor === "rule_engine" ? mobileT("mobile.ui.productshell.fe3f473ffc") : actor === "sensor" ? mobileT("mobile.ui.productshell.01f2c16cda") : actor === "sync" ? mobileT("mobile.ui.productshell.e88ab5ba61") : mobileT("mobile.ui.productshell.5630b886f9"); }
function optionalFiniteNumber(value: string): number | undefined { const parsed = Number(value.trim()); return value.trim() && Number.isFinite(parsed) ? parsed : undefined; }
function formatRestSeconds(seconds: number): string { return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`; }
function setDose(set: { targetReps?: { min: number; max: number }; targetDuration?: { value: number; unit: string }; targetDistance?: { value: number; unit: string }; targetLoad?: { value: number; unit: string }; targetRir?: number }): string {
  const volume = set.targetReps ? mobileT("mobile.ui.productshell.2b0811a078", { value0: set.targetReps.min, value1: set.targetReps.max }) : set.targetDuration ? `${set.targetDuration.value} ${set.targetDuration.unit}` : set.targetDistance ? `${set.targetDistance.value} ${set.targetDistance.unit}` : mobileT("mobile.ui.productshell.78081971e6");
  return `${volume}${set.targetLoad ? ` · ${set.targetLoad.value} ${set.targetLoad.unit}` : ""}${set.targetRir !== undefined ? ` · RIR ${set.targetRir}` : ""}`;
}
function todayCopy(today: CoachProductProjection["today"]): { title: string; subtitle: string; empty: string; action: string } {
  if (today.state === "record_first") return { title: "今天由你安排", subtitle: "记录饮食、身体状态，或开始一次自由训练", empty: "没有计划也可以持续记录和训练", action: "记录或自由训练" };
  if (today.state === "safety_hold") return { title: mobileT("mobile.ui.productshell.de0ebad8bf"), subtitle: today.reason ?? mobileT("mobile.ui.productshell.0539554585"), empty: mobileT("mobile.ui.productshell.040f13acaa"), action: mobileT("mobile.ui.productshell.04e47b53c8") };
  if (today.state === "planner_hold") return { title: mobileT("mobile.ui.productshell.59b0ae1c3b"), subtitle: today.reason ?? "", empty: mobileT("mobile.ui.productshell.fd2ae92498"), action: mobileT("mobile.ui.productshell.04e47b53c8") };
  if (today.state === "activity") return { title: today.session?.title ?? mobileT("mobile.ui.productshell.ce7b14e405"), subtitle: mobileT("mobile.ui.productshell.801d1f2ce9"), empty: mobileT("mobile.ui.productshell.bc47ec6438"), action: mobileT("mobile.ui.productshell.920d6c6570") };
  if (today.state === "rest") return { title: today.session?.title ?? mobileT("mobile.ui.productshell.7369b4b9a3"), subtitle: mobileT("mobile.ui.productshell.e4152d8d42"), empty: mobileT("mobile.ui.productshell.04bc15c7e9"), action: mobileT("mobile.ui.productshell.d0c5b8dced") };
  if (today.state === "completed") return { title: today.session?.title ?? mobileT("mobile.ui.productshell.0014c0b984"), subtitle: mobileT("mobile.ui.productshell.155f1234ea"), empty: mobileT("mobile.ui.productshell.ee8d9e2931"), action: mobileT("mobile.ui.productshell.5cd5db139a") };
  return { title: today.session?.title ?? mobileT("mobile.ui.productshell.573a9df92c"), subtitle: mobileT("mobile.ui.productshell.ccedc9e6e9"), empty: "", action: today.action === "continue_workout" ? mobileT("mobile.ui.productshell.3166554c46") : mobileT("mobile.ui.productshell.be24590d21") };
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
  planLifecycleActions: { paddingHorizontal: 18, paddingVertical: 8, flexDirection: "row", justifyContent: "center", gap: 16, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  completionProposal: { gap: 12, paddingBottom: 18 },
  completionProposalText: { color: colors.ink2, fontSize: 14, lineHeight: 21 },
  errorText: { color: colors.terra, fontSize: 12, lineHeight: 18 },
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
  content: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 168, gap: 14 },
  quickChoiceCard: { backgroundColor: colors.white, borderRadius: 22, padding: 17, gap: 13, borderWidth: 1, borderColor: "rgba(22,24,29,0.055)" },
  muscleRow: { gap: 4 },
  muscleRowHeader: { gap: 2 },
  muscleRowTitle: { color: colors.ink, fontSize: 14, fontWeight: "800" },
  muscleRowMeta: { color: colors.ink3, fontSize: 12 },
  muscleRowDetail: { paddingLeft: 10, gap: 2 },
  muscleRowDetailText: { color: colors.ink2, fontSize: 12 },
  muscleRowLimit: { color: colors.ink3, fontSize: 11, lineHeight: 16 },
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
  profileCard: { backgroundColor: colors.white, borderRadius: radius.card, paddingHorizontal: 16 }, profileSummaryCard: { paddingHorizontal: 18, paddingVertical: 16 }, profileSummaryCopy: { flex: 1, minWidth: 0 }, profileSingleLineCard: { paddingHorizontal: 18, paddingVertical: 17 }, reminderSettingsCard: { paddingHorizontal: 18, paddingTop: 17, paddingBottom: 8 }, reminderSettingsIntro: { paddingHorizontal: 2, paddingBottom: 12, marginBottom: 2 }, profileStart: { backgroundColor: colors.dark, borderRadius: radius.chip, minHeight: 48, alignItems: "center", justifyContent: "center" }, profileStartText: { color: colors.white, fontSize: 15, fontWeight: "800" }, profileRow: { minHeight: 50, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomColor: colors.line, borderBottomWidth: StyleSheet.hairlineWidth }, profileLabel: { color: colors.ink2, fontSize: 14 }, profileValue: { color: colors.ink, fontSize: 14, fontWeight: "700" }, privacySummaryLoading: { minHeight: 74, alignItems: "center", justifyContent: "center" }, privacySummaryFooter: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }, privacySummaryFooterText: { color: colors.ink3, fontSize: 12, flex: 1 }, privacySheet: { maxHeight: "84%", backgroundColor: colors.paper, borderTopLeftRadius: 30, borderTopRightRadius: 30, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 28 }, privacySheetLoading: { minHeight: 160, alignItems: "center", justifyContent: "center" }, privacyDetailList: { gap: 10, paddingBottom: 8 }, privacyDetailBlock: { backgroundColor: colors.white, borderRadius: radius.row, padding: 14, gap: 7 }, privacyDetailHeading: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 12 }, privacyDetailTitle: { color: colors.ink, fontSize: 14, fontWeight: "900" }, privacyDetailSummary: { color: colors.limeInk, fontSize: 12, fontWeight: "800", textAlign: "right" }, privacyDetailText: { color: colors.ink2, fontSize: 12, lineHeight: 18 }, privacyDetailMeta: { color: colors.ink3, fontSize: 11, lineHeight: 17, marginTop: 1 }, privacyManageButton: { minHeight: 46, borderRadius: radius.chip, backgroundColor: colors.dark, alignItems: "center", justifyContent: "center", marginTop: 2 }, privacyManageButtonText: { color: colors.lime, fontSize: 14, fontWeight: "900" }, replicaConflict: { borderLeftWidth: 2, borderLeftColor: colors.limeDeep, backgroundColor: colors.paper, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, gap: 2, marginTop: 1 }, replicaConflictTitle: { color: colors.ink, fontSize: 12, fontWeight: "800" }, replicaSyncButton: { minHeight: 42, borderRadius: radius.chip, backgroundColor: colors.dark, alignItems: "center", justifyContent: "center", marginTop: 3 }, replicaSyncButtonText: { color: colors.lime, fontSize: 13, fontWeight: "900" }, healthConnectionCard: { paddingVertical: 16, gap: 10 }, healthConnectionTop: { flexDirection: "row", alignItems: "center", gap: 12 }, healthConnectionTitle: { color: colors.ink, fontSize: 15, fontWeight: "900" }, healthConnectionMeta: { color: colors.ink3, fontSize: 12, lineHeight: 18, marginTop: 3 }, healthConnectionNote: { color: colors.ink2, fontSize: 12, lineHeight: 18 }, healthImportedList: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line, marginTop: 2 }, healthConnectionActions: { flexDirection: "row", gap: 8, marginTop: 2 }, healthConnectionPrimary: { flex: 1, minHeight: 40, borderRadius: radius.chip, backgroundColor: colors.dark, alignItems: "center", justifyContent: "center", paddingHorizontal: 12 }, healthConnectionPrimaryText: { color: colors.lime, fontSize: 12, fontWeight: "900" }, healthConnectionSecondary: { minHeight: 40, borderRadius: radius.chip, backgroundColor: colors.paper, borderColor: colors.line, borderWidth: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 14 }, healthConnectionSecondaryText: { color: colors.ink, fontSize: 12, fontWeight: "800" }, actionLogCard: { paddingVertical: 4, overflow: "hidden" }, actionLogRow: { flexDirection: "row", alignItems: "center", minHeight: 68, paddingVertical: 10, borderBottomColor: colors.line, borderBottomWidth: StyleSheet.hairlineWidth, gap: 10 }, actionLogRowLast: { borderBottomWidth: 0 }, actionLogBody: { flex: 1 }, actionLogTitle: { color: colors.ink, fontSize: 13, fontWeight: "800" }, actionLogMeta: { color: colors.ink3, fontSize: 11, marginTop: 4 },
  permissionScrim: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: 44, justifyContent: "flex-end", backgroundColor: "rgba(10,12,10,0.42)" }, permissionSheet: { maxHeight: "82%", backgroundColor: colors.paper, borderTopLeftRadius: 30, borderTopRightRadius: 30, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 28 }, permissionList: { gap: 9, paddingBottom: 8 }, permissionRow: { backgroundColor: colors.white, borderRadius: radius.row, paddingHorizontal: 14, paddingVertical: 13, flexDirection: "row", alignItems: "center", gap: 12 }, permissionBody: { flex: 1 }, permissionTitle: { color: colors.ink, fontSize: 14, fontWeight: "800" }, permissionDescription: { color: colors.ink3, fontSize: 11, lineHeight: 16, marginTop: 4 }, permissionSwitch: { width: 45, height: 28, borderRadius: 16, backgroundColor: colors.paper2, padding: 3, justifyContent: "center" }, permissionSwitchOn: { backgroundColor: colors.limeDeep, alignItems: "flex-end" }, permissionKnob: { width: 22, height: 22, borderRadius: 12, backgroundColor: colors.white, shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 2, shadowOffset: { width: 0, height: 1 } }, permissionKnobOn: { backgroundColor: colors.dark }, actionLogScrim: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: 44, justifyContent: "flex-end", backgroundColor: "rgba(10,12,10,0.42)" }, actionLogSheet: { maxHeight: "82%", backgroundColor: colors.paper, borderTopLeftRadius: 30, borderTopRightRadius: 30, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 28 }, actionLogList: { gap: 9, paddingBottom: 8 }, actionLogDetailRow: { backgroundColor: colors.white, borderRadius: radius.row, padding: 14, gap: 4 }, actionLogDetailTop: { flexDirection: "row", justifyContent: "space-between", gap: 12 }, actionLogResult: { color: colors.limeInk, fontSize: 11, fontWeight: "800" }, actionLogDetailMeta: { color: colors.ink3, fontSize: 11, lineHeight: 16 }, actionLogIntent: { color: colors.ink2, fontSize: 12, lineHeight: 18, marginVertical: 2 }, actionLogReversible: { color: colors.limeInk, fontSize: 11, fontWeight: "800", marginTop: 2 },
  nutritionLedgerCard: { backgroundColor: colors.white, borderRadius: 24, padding: 17, gap: 13, borderWidth: 1, borderColor: "rgba(22,24,29,0.055)" }, nutritionCoverage: { color: colors.limeInk, fontSize: 12, fontWeight: "900" }, nutritionProgressGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, nutritionProgressItem: { width: "48%", backgroundColor: colors.paper2, borderRadius: 12, padding: 10, gap: 3 }, nutritionProgressLabel: { color: colors.ink2, fontSize: 10, fontWeight: "800" }, nutritionProgressValue: { color: colors.ink, fontSize: 18, fontFamily: "monospace", fontWeight: "900" }, nutritionProgressMeta: { color: colors.ink3, fontSize: 9, lineHeight: 13 }, nutritionMealList: { backgroundColor: colors.paper, borderRadius: 14, paddingHorizontal: 12 }, nutritionMealRow: { minHeight: 44, justifyContent: "center", borderBottomColor: colors.line, borderBottomWidth: StyleSheet.hairlineWidth }, nutritionMealTitle: { color: colors.ink, fontSize: 12, fontWeight: "800" }, nutritionMealMeta: { color: colors.ink3, fontSize: 10, marginTop: 3 }, nutritionRecordButton: { flex: 1, minHeight: 44, borderRadius: radius.chip, backgroundColor: colors.dark, alignItems: "center", justifyContent: "center" }, nutritionRecordButtonText: { color: colors.white, fontSize: 13, fontWeight: "900" }, recoveryStatusCard: { backgroundColor: colors.white, borderRadius: radius.card, padding: 16, gap: 9 }, recoveryCheckInButton: { minHeight: 40, borderRadius: radius.chip, backgroundColor: colors.paper2, alignItems: "center", justifyContent: "center" }, recoveryCheckInText: { color: colors.ink3, fontSize: 12, fontWeight: "900" }, question: { gap: 9 }, questionLabel: { color: colors.ink, fontWeight: "800", fontSize: 15 }, optionList: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, option: { backgroundColor: colors.white, borderRadius: radius.chip, borderWidth: 1, borderColor: "transparent", minHeight: 40, paddingHorizontal: 13, justifyContent: "center" }, optionSelected: { backgroundColor: "#EEF9C7", borderColor: colors.limeDeep }, optionText: { color: colors.ink2, fontSize: 13, fontWeight: "700" }, optionTextSelected: { color: colors.limeInk }, formError: { color: colors.terra, fontSize: 12 }, previewRejectButton: { minHeight: 44, alignItems: "center", justifyContent: "center", marginBottom: 24 }, previewRejectText: { color: colors.ink3, fontSize: 13, fontWeight: "800" },
  workoutTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }, workoutTopActions: { alignItems: "flex-end", gap: 8 }, workoutProgress: { color: colors.limeInk, backgroundColor: colors.lime, borderRadius: radius.chip, paddingHorizontal: 11, paddingVertical: 7, fontWeight: "900" }, workoutCoachButton: { minHeight: 34, minWidth: 72, borderRadius: radius.chip, backgroundColor: colors.dark, alignItems: "center", justifyContent: "center", paddingHorizontal: 12 }, workoutCoachButtonText: { color: colors.lime, fontSize: 12, fontWeight: "900" }, currentSetCard: { backgroundColor: colors.dark, borderRadius: 26, padding: 22, gap: 10 }, currentSetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }, completedHistoryButton: { minHeight: 44, justifyContent: "center", paddingHorizontal: 4 }, completedHistoryButtonText: { color: colors.lime, fontSize: 12, fontWeight: "900" }, notRecordedText: { color: "#979C93", fontSize: 12, fontWeight: "800" }, currentSetTitle: { color: colors.white, fontSize: 22, fontWeight: "900" }, currentSetDose: { color: "#C5C9C0", fontSize: 15 }, currentSetBoundary: { color: "#979C93", fontSize: 11, lineHeight: 17, marginBottom: 4 }, completedHistory: { borderRadius: 14, backgroundColor: "rgba(255,255,255,0.08)", paddingHorizontal: 12 }, completedHistoryRow: { minHeight: 42, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(255,255,255,0.12)" }, completedHistoryIndex: { color: "#979C93", width: 18, fontFamily: "monospace" }, completedHistoryDose: { color: colors.white, minWidth: 78, fontWeight: "800" }, completedHistoryDelta: { color: "#B6BAAF", flex: 1, fontSize: 11 }, setReviewTitle: { color: colors.white, fontSize: 18, fontWeight: "900" }, setReviewSnapshot: { color: "#B6BAAF", fontSize: 11 }, setActions: { flexDirection: "row", justifyContent: "space-between", gap: 12 }, actualButton: { flex: 1, alignItems: "center", minHeight: 44, justifyContent: "center" }, actualButtonText: { color: colors.lime, fontWeight: "800", fontSize: 13 }, skipSetText: { color: "#F5B6A4", fontWeight: "800", fontSize: 13 }, actualForm: { gap: 8 }, actualField: { minHeight: 44, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.10)", flexDirection: "row", alignItems: "center", paddingHorizontal: 12 }, actualLabel: { color: "#B6BAAF", width: 52, fontSize: 12 }, actualInput: { flex: 1, color: colors.white, fontSize: 15, fontWeight: "700", paddingVertical: 0, textAlign: "right" }, workoutTask: { backgroundColor: colors.white, borderRadius: radius.card, padding: 16, gap: 4 }, workoutTaskSelected: { borderWidth: 2, borderColor: colors.limeDeep }, workoutRouteRow: { flexDirection: "row", alignItems: "center", minHeight: 44 }, workoutRouteMeta: { color: colors.ink3, fontSize: 12 }, workoutTaskTitle: { color: colors.ink, fontWeight: "800", fontSize: 15, marginBottom: 4 }, workoutSetRow: { flexDirection: "row", alignItems: "center", minHeight: 38, gap: 10 }, workoutSetIndex: { width: 20, height: 20, borderRadius: 10, backgroundColor: colors.paper2, color: colors.ink2, fontSize: 11, textAlign: "center", paddingTop: 3 }, workoutSetDose: { flex: 1, color: colors.ink2, fontFamily: "monospace", fontSize: 12 }, workoutSetState: { color: colors.ink3, fontSize: 11 }, workoutSetDone: { color: colors.limeDeep, fontWeight: "800" }, workoutSetSkipped: { color: colors.terra, fontWeight: "800" }, manageWorkoutTasksButton: { minHeight: 44, borderRadius: radius.chip, borderWidth: 1, borderColor: "#3B4039", alignItems: "center", justifyContent: "center", marginTop: 2 }, manageWorkoutTasksText: { color: colors.white, fontSize: 13, fontWeight: "800" }, workoutTaskEditorRow: { backgroundColor: colors.white, borderRadius: radius.row, padding: 12, gap: 8 }, workoutTaskEditorRowSelected: { borderWidth: 1, borderColor: colors.limeDeep }, workoutTaskEditorPrimary: { minHeight: 44 }, workoutTaskEditorActions: { flexDirection: "row", flexWrap: "wrap", gap: 10 }, workoutTaskTiny: { minHeight: 44, justifyContent: "center" }, workoutTaskTinyText: { color: colors.ink2, fontSize: 12, fontWeight: "800" }, workoutTaskPicker: { backgroundColor: "#EEF9C7", borderRadius: radius.card, padding: 14, gap: 9, marginTop: 4 }, workoutCatalogList: { gap: 6 }, workoutCatalogRow: { backgroundColor: colors.white, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 }, workoutCatalogRowSelected: { borderWidth: 1, borderColor: colors.limeDeep }, workoutTaskBoundary: { color: colors.ink2, fontSize: 11, lineHeight: 16 }, workoutTaskAddFields: { flexDirection: "row", gap: 8 }, workoutTaskNumberField: { flex: 1, minHeight: 46, borderRadius: 12, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white, flexDirection: "row", alignItems: "center", paddingHorizontal: 10 }, workoutTaskNumberLabel: { color: colors.ink2, fontSize: 12 }, workoutTaskNumberInput: { flex: 1, color: colors.ink, fontFamily: "monospace", fontWeight: "800", textAlign: "right", fontSize: 14, paddingVertical: 0 }, workoutTaskButtons: { flexDirection: "row", gap: 8 }, workoutTaskSecondary: { flex: 1, minHeight: 46, borderRadius: radius.chip, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center", backgroundColor: colors.white }, workoutTaskSecondaryText: { color: colors.ink, fontSize: 12, fontWeight: "800" }, workoutTaskAddButton: { flex: 1, marginTop: 0 }, pauseButton: { minHeight: 44, borderRadius: radius.chip, alignItems: "center", justifyContent: "center" }, pauseButtonText: { color: colors.ink3, fontSize: 13, fontWeight: "800" }, safetyPauseButton: { minHeight: 44, borderRadius: radius.chip, alignItems: "center", justifyContent: "center", backgroundColor: colors.terraSoft }, safetyPauseButtonText: { color: colors.terra, fontSize: 13, fontWeight: "900" }, safetyPauseScrim: { ...StyleSheet.absoluteFill, zIndex: 55, justifyContent: "flex-end", backgroundColor: "rgba(10,12,10,0.42)" }, safetyPauseSheet: { backgroundColor: colors.paper, borderTopLeftRadius: 30, borderTopRightRadius: 30, paddingHorizontal: 22, paddingTop: 12, paddingBottom: 38, gap: 10 }, safetyPauseTitle: { color: colors.ink, fontSize: 24, fontWeight: "900" }, safetyPauseDetail: { color: colors.ink2, fontSize: 13, lineHeight: 19, marginBottom: 4 }, safetyPauseChoice: { minHeight: 50, paddingHorizontal: 14, borderRadius: radius.row, backgroundColor: colors.white, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, safetyPauseChoiceText: { flex: 1, color: colors.ink, fontSize: 14, fontWeight: "800" }, safetyPauseCancel: { minHeight: 46, borderRadius: radius.chip, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.line }, safetyPauseCancelText: { color: colors.ink2, fontSize: 14, fontWeight: "800" }, skipSetSheet: { backgroundColor: colors.paper, borderTopLeftRadius: 30, borderTopRightRadius: 30, paddingHorizontal: 22, paddingTop: 12, paddingBottom: 38, gap: 10 }, skipSetTitle: { color: colors.ink, fontSize: 24, fontWeight: "900" }, skipSetDetail: { color: colors.ink2, fontSize: 13, lineHeight: 19 }, skipSetInput: { minHeight: 86, borderRadius: radius.row, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white, color: colors.ink, paddingHorizontal: 13, paddingVertical: 11, textAlignVertical: "top", fontSize: 14 }, skipSetConfirm: { minHeight: 48, borderRadius: radius.chip, alignItems: "center", justifyContent: "center", backgroundColor: colors.dark }, skipSetConfirmText: { color: colors.white, fontWeight: "900", fontSize: 15 }, finishButton: { borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white, minHeight: 48, borderRadius: radius.chip, alignItems: "center", justifyContent: "center" }, finishButtonText: { color: colors.ink, fontWeight: "800" }, pausedPage: { flex: 1, padding: 20, justifyContent: "center", backgroundColor: colors.paper }, pausedCard: { backgroundColor: colors.dark, padding: 24, borderRadius: 28, gap: 13 }, pausedTitle: { color: colors.white, fontSize: 30, fontWeight: "900" }, pausedDetail: { color: "#B7BBB3", fontSize: 14, lineHeight: 21, marginBottom: 8 },
  monitorEntry: { minHeight: 62, backgroundColor: colors.white, borderRadius: radius.row, paddingHorizontal: 15, paddingVertical: 10, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, monitorEntryTitle: { color: colors.ink, fontSize: 13, fontWeight: "800" }, monitorEntrySub: { color: colors.ink3, fontSize: 11, marginTop: 3 }, monitorEntryButton: { minWidth: 54, minHeight: 34, borderRadius: radius.chip, alignItems: "center", justifyContent: "center", backgroundColor: colors.dark }, monitorEntryButtonText: { color: colors.lime, fontSize: 12, fontWeight: "900" }, workoutNotice: { backgroundColor: "#EEF9C7", borderRadius: radius.card, minHeight: 84, padding: 14, flexDirection: "row", alignItems: "center", gap: 12 }, workoutNoticeDetail: { color: colors.ink2, fontSize: 11, lineHeight: 16 }, workoutConfirmButton: { minWidth: 58, minHeight: 38, borderRadius: radius.chip, backgroundColor: colors.dark, alignItems: "center", justifyContent: "center", paddingHorizontal: 12 }, workoutConfirmButtonText: { color: colors.lime, fontSize: 12, fontWeight: "900" },
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
  workoutSetFlipStage: { position: "relative" },
  workoutSetFlipFace: { position: "absolute", top: 0, left: 0, right: 0, backfaceVisibility: "hidden" },
  tabbar: { height: 66, flexDirection: "row", paddingTop: 9, paddingBottom: 6 }, tab: { flex: 1, alignItems: "center", gap: 3 }, tabIcon: { color: colors.ink3, fontSize: 17, fontWeight: "700" }, tabLabel: { color: colors.ink3, fontSize: 9 }, tabOn: { color: colors.ink, fontWeight: "900" },
});
