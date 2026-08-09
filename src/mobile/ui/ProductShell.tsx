import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  Platform,
} from "react-native";

import type { CoachApplication } from "../../coach";
import type { CoachContextKind, CoachSession, ContextRef, EvidenceBriefArtifact, NutritionObservationDraftArtifact } from "../../coach/model";
import type { CustomExerciseVariantView, MovementPattern } from "../../knowledge";
import {
  CoachDrawer,
  CoachStreamProjection,
  type CoachStreamSnapshot,
} from "../../coach/ui";
import {
  timelineSummary,
  coachDrawerAvailableForRoute,
  canCorrectTimelineEntry,
  type CoachDrawerRoute,
  type CalendarPresentationMode,
  type CoachProductProjection,
  type ProductSession,
  type WorkoutOutcomeProductSummary,
  presentReplicaSyncOverview,
} from "../../product";
import type { TimelineReadEvent } from "../../timeline";
import { createManualMealObservation } from "../../nutrition";
import { colors, radius } from "./theme";
import { ANDROID_HEALTH_CONNECT_MVP_METRICS } from "../native/AndroidHealthConnectPort";
import { APPLE_HEALTHKIT_MVP_METRICS } from "../native/AppleHealthKitPort";
import { ProgressScreen as VideoLibraryScreen, type ReplaySelection } from "./ProgressScreen";
import { ReplayScreen } from "./ReplayScreen";
import { WorkoutMonitorWorkspace } from "./WorkoutMonitorWorkspace";
import { NutritionObservationDraftSheet } from "./NutritionObservationDraftSheet";
import { TimelineCorrectionSheet } from "./TimelineCorrectionSheet";
import { WorkoutOutcomeCorrectionSheet } from "./WorkoutOutcomeCorrectionSheet";
import { RemoteModelSetupSheet } from "./RemoteModelSetupSheet";
import type { ProductShellStateStore } from "./ProductShellStateStore";
import {
  applyInboundNavigationIntent,
  initialProductShellState,
  resolveMaxPowerDeepLink,
  type ProductDeepLinkRoute,
  type ProductCoachAttachment,
  type ProductShellRecovery,
  type ProductShellState,
} from "./productNavigation";

export type ProductRoute = CoachDrawerRoute;
type WorkoutStartMode = "record_only" | "coach_monitor";

export interface ProductShellProps {
  application: CoachApplication;
  userId: string;
  /** Any validated notification or OS Linking event uses the same registry. */
  incomingDeepLink?: string;
  /** @deprecated Use incomingDeepLink for notification and OS URL events. */
  notificationDeepLink?: string;
  /** Local presentation-state port; domain facts remain in CoachApplication. */
  productShellStateStore?: ProductShellStateStore;
  /** Resolved before rendering by the native composition root. */
  initialProductShellRecovery?: ProductShellRecovery;
}

/** Shared iOS/Android shell. It owns navigation presentation state only. */
export function ProductShell({ application, userId, incomingDeepLink, notificationDeepLink, productShellStateStore, initialProductShellRecovery }: ProductShellProps) {
  const initialShellState = initialProductShellRecovery?.state ?? initialProductShellState(localDate());
  const [route, setRoute] = useState<ProductRoute>(initialShellState.navigation.route);
  const [date, setDate] = useState(initialShellState.navigation.date);
  const [calendarMode, setCalendarMode] = useState<CalendarPresentationMode>(initialShellState.navigation.calendarMode);
  const [workoutId, setWorkoutId] = useState<string | undefined>(initialShellState.navigation.workoutId);
  const [replaySelection, setReplaySelection] = useState<ReplaySelection>();
  const [replayReturnRoute, setReplayReturnRoute] = useState<"video_library" | "workout">("video_library");
  const [coachExpanded, setCoachExpanded] = useState(initialShellState.navigation.coachExpanded);
  const [showWorkoutStartChoice, setShowWorkoutStartChoice] = useState(false);
  const [showActivityLog, setShowActivityLog] = useState(false);
  const [timelineCorrection, setTimelineCorrection] = useState<TimelineReadEvent>();
  const [workoutSummary, setWorkoutSummary] = useState<WorkoutOutcomeProductSummary>();
  const [workoutCorrectionId, setWorkoutCorrectionId] = useState<string>();
  const [nutritionDraft, setNutritionDraft] = useState<NutritionObservationDraftArtifact>();
  const [nutritionDraftBusy, setNutritionDraftBusy] = useState(false);
  const [screen, setScreen] = useState<CoachProductProjection>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const stream = useRef(new CoachStreamProjection());
  const [streamSnapshot, setStreamSnapshot] = useState<CoachStreamSnapshot>(stream.current.snapshot());
  const [coachSession, setCoachSession] = useState<CoachSession>();
  const [coachAttachment, setCoachAttachment] = useState<ProductCoachAttachment | undefined>(initialShellState.coachAttachment);
  const initialShellRecoveryHandled = useRef(false);
  const productShellSaveChain = useRef(Promise.resolve());
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
        calendarAnchorDate: date,
      });
      setScreen(projection);
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法读取本地资料");
    } finally {
      setLoading(false);
    }
  }, [application, calendarMode, date, userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (route === "profile" || route === "onboarding" || route === "video_library" || route === "replay") {
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
    setRoute(next.route);
    setDate(next.date);
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
    setCoachSession(undefined);
    setCoachAttachment((current) => current && !contextAcceptsRestoredCoach(current.context, context, screen === undefined)
      ? { ...current, foreground: "minimized" }
      : current);
    const next = new CoachStreamProjection();
    stream.current = next;
    setStreamSnapshot(next.snapshot());
  }, [context.kind, context.ref]);

  useEffect(() => {
    if (coachAttachment && !contextAcceptsRestoredCoach(coachAttachment.context, context, screen === undefined)) {
      setCoachExpanded(false);
    }
  }, [coachAttachment, context, screen]);

  const beginOrResumeWorkout = useCallback(async (mode: WorkoutStartMode = "record_only") => {
    const today = screen?.today;
    if (!today?.session) return;
    try {
      let id = today.activeWorkout?.id;
      if (!id) {
        if (!screen?.source.planId || !screen.source.planRevision) throw new Error("当前计划无法启动训练");
        id = `workout-${Date.now().toString(36)}`;
        await application.prepareWorkoutSession({
          userId,
          workoutId: id,
          prescriptionRef: {
            planId: screen.source.planId,
            planRevision: screen.source.planRevision,
            sessionPrescriptionId: today.session.id,
          },
          mode,
          idempotencyKey: `mobile-workout:${id}:prepare`,
        });
        await application.activateWorkoutSession({
          userId,
          workoutId: id,
          mode,
          idempotencyKey: `mobile-workout:${id}:activate`,
        });
      } else if (today.activeWorkout?.status === "paused") {
        await application.resumeWorkoutSession({
          userId,
          workoutId: id,
          idempotencyKey: `mobile-workout:${id}:resume`,
        });
      }
      setWorkoutId(id);
      setCoachExpanded(false);
      setRoute("workout");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "暂时无法开始训练");
    }
  }, [application, refresh, screen, userId]);

  const requestWorkoutStart = useCallback(() => {
    if (screen?.today.activeWorkout) {
      void beginOrResumeWorkout();
      return;
    }
    setShowWorkoutStartChoice(true);
  }, [beginOrResumeWorkout, screen?.today.activeWorkout]);

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
    const session = await resolveCoachSession(context);
    if (!session) {
      setCoachSession(undefined);
      setCoachAttachment((current) => current && sameCoachContext(current.context, context) ? undefined : current);
      return;
    }
    setCoachSession(session);
    setCoachAttachment({
      sessionId: session.id,
      context: session.context,
      foreground: coachExpanded ? "expanded" : "minimized",
    });
    const persisted = await application.readSessionProjection(session.id);
    const next = new CoachStreamProjection(persisted.artifacts, undefined, persisted.presentations, persisted.pendingHumanActions);
    persisted.runEvents.forEach((event) => next.accept(event));
    stream.current = next;
    setStreamSnapshot(next.snapshot());
  }, [application, coachExpanded, context, resolveCoachSession]);

  const sendToCoach = useCallback(async (text: string, messageContext: ContextRef) => {
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
      const persisted = await application.readSessionProjection(session.id);
      await application.sendCoachTurn({ sessionId: session.id, text });
      const afterTurn = await application.readSessionProjection(session.id);
      const persistedNext = new CoachStreamProjection(afterTurn.artifacts, undefined, afterTurn.presentations, afterTurn.pendingHumanActions);
      afterTurn.runEvents.forEach((event) => persistedNext.accept(event));
      stream.current = persistedNext;
      setStreamSnapshot(persistedNext.snapshot());
      await refresh();
    } catch (cause) {
      stream.current.fail({
        id: `send-${Date.now()}`,
        message: cause instanceof Error ? cause.message : "暂时无法继续对话",
      });
      setStreamSnapshot(stream.current.snapshot());
    }
  }, [application, coachExpanded, refresh, resolveCoachSession, userId]);

  const handleCoachExpandedChange = useCallback((expanded: boolean) => {
    setCoachExpanded(expanded);
    setCoachAttachment((current) => {
      if (!current) return current;
      return {
        ...current,
        foreground: expanded && sameCoachContext(current.context, context) ? "expanded" : "minimized",
      };
    });
    if (expanded) void hydrateCoach();
  }, [context, hydrateCoach]);

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
            const next = new CoachStreamProjection(persisted.artifacts, undefined, persisted.presentations, persisted.pendingHumanActions);
            persisted.runEvents.forEach((event) => next.accept(event));
            stream.current = next;
            setStreamSnapshot(next.snapshot());
          }
        }
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
          foreground: coachExpanded && persistableRoute !== "profile" ? "expanded" as const : "minimized" as const,
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
      await application.respondToPendingHumanAction({ userId, pendingActionId, optionId });
      await hydrateCoach();
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "暂时无法提交这个选择");
    }
  }, [application, hydrateCoach, refresh, userId]);

  if (loading && !screen) return <LoadingState />;
  if (error && !screen) return <ErrorState message={error} onRetry={() => void refresh()} />;
  if (!screen) return <LoadingState />;

  return (
    <View style={styles.page}>
      {route === "today" && <TodayScreen screen={screen} onOpenCalendar={() => setRoute("calendar")} onOpenCoach={() => handleCoachExpandedChange(true)} onStartOnboarding={() => setRoute("onboarding")} onBeginWorkout={requestWorkoutStart} onRecordActivity={() => setShowActivityLog(true)} onViewWorkoutSummary={setWorkoutSummary} onCorrectTimeline={setTimelineCorrection} />}
      {route === "calendar" && (
        <CalendarScreen
          screen={screen}
          onSelectDate={setDate}
          onPrevious={() => setDate((current) => calendarMode === "week" ? shiftCalendarDate(current, -7) : shiftCalendarMonth(current, -1))}
          onNext={() => setDate((current) => calendarMode === "week" ? shiftCalendarDate(current, 7) : shiftCalendarMonth(current, 1))}
          onToggleMode={() => setCalendarMode((mode) => mode === "week" ? "month" : "week")}
          onViewWorkoutSummary={setWorkoutSummary}
          onCorrectTimeline={setTimelineCorrection}
        />
      )}
      {route === "plan" && <PlanScreen application={application} userId={userId} screen={screen} onUpdated={() => void refresh()} />}
      {route === "progress" && <ProgressScreen screen={screen} onOpenVideoLibrary={() => setRoute("video_library")} />}
      {route === "profile" && <ProfileScreen application={application} userId={userId} screen={screen} onStartOnboarding={() => setRoute("onboarding")} onUpdated={() => void refresh()} />}
      {route === "onboarding" && <OnboardingScreen application={application} userId={userId} onCompleted={() => { setRoute("today"); void refresh(); }} />}
      {route === "workout" && workoutId ? <WorkoutScreen application={application} userId={userId} workoutId={workoutId} onOpenCoach={() => handleCoachExpandedChange(true)} onFinished={() => { setWorkoutId(undefined); setRoute("today"); void refresh(); }} onUnavailable={() => { setWorkoutId(undefined); setRoute("today"); void refresh(); }} onOpenSavedVideo={(selection) => { setReplaySelection(selection); setReplayReturnRoute("workout"); setRoute("replay"); }} /> : null}
      {route === "video_library" && <VideoLibraryScreen onOpenReplay={(selection) => { setReplaySelection(selection); setReplayReturnRoute("video_library"); setRoute("replay"); }} />}
      {route === "replay" && replaySelection ? <ReplayScreen {...replaySelection} onExit={() => { setReplaySelection(undefined); setRoute(replayReturnRoute); }} /> : null}

      {error ? <View style={styles.inlineError}><Text style={styles.inlineErrorText}>{error}</Text></View> : null}
      {route !== "onboarding" && route !== "workout" && route !== "video_library" && route !== "replay" ? <BottomNavigation route={route} onChange={setRoute} /> : null}
      {coachDrawerAvailableForRoute(route) ? <CoachDrawer
        context={context}
        stream={streamSnapshot}
        session={coachSession}
        expanded={coachExpanded}
        bottomInset={route === "workout" ? 16 : 84}
        onExpandedChange={handleCoachExpandedChange}
        onSend={(text, messageContext) => void sendToCoach(text, messageContext)}
        onCardAction={(actionId, artifactId) => void handleCardAction(actionId, artifactId)}
        onHumanAction={(pendingActionId, optionId) => void handleHumanAction(pendingActionId, optionId)}
      /> : null}
      {showWorkoutStartChoice && screen.today.session ? (
        <WorkoutStartChoice
          session={screen.today.session}
          onChoose={(mode) => {
            setShowWorkoutStartChoice(false);
            void beginOrResumeWorkout(mode);
          }}
          onDismiss={() => setShowWorkoutStartChoice(false)}
        />
      ) : null}
      {showActivityLog ? <ActivityLogEntry application={application} userId={userId} onDismiss={() => setShowActivityLog(false)} onSaved={() => { setShowActivityLog(false); void refresh(); }} /> : null}
      {timelineCorrection ? <TimelineCorrectionSheet application={application} userId={userId} entry={timelineCorrection} onDismiss={() => setTimelineCorrection(undefined)} onSaved={() => { setTimelineCorrection(undefined); void refresh(); }} /> : null}
      {workoutSummary ? <WorkoutOutcomeSummarySheet summary={workoutSummary} onDismiss={() => setWorkoutSummary(undefined)} onCorrect={() => { setWorkoutCorrectionId(workoutSummary.id); setWorkoutSummary(undefined); }} /> : null}
      {workoutCorrectionId ? <WorkoutOutcomeCorrectionSheet application={application} userId={userId} workoutId={workoutCorrectionId} onDismiss={() => setWorkoutCorrectionId(undefined)} onSaved={() => { setWorkoutCorrectionId(undefined); void refresh(); }} /> : null}
      {nutritionDraft ? <NutritionObservationDraftSheet
        artifact={nutritionDraft}
        busy={nutritionDraftBusy}
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

function TodayScreen({ screen, onOpenCalendar, onOpenCoach, onStartOnboarding, onBeginWorkout, onRecordActivity, onViewWorkoutSummary, onCorrectTimeline }: { screen: CoachProductProjection; onOpenCalendar: () => void; onOpenCoach: () => void; onStartOnboarding: () => void; onBeginWorkout: () => void; onRecordActivity: () => void; onViewWorkoutSummary: (summary: WorkoutOutcomeProductSummary) => void; onCorrectTimeline: (entry: TimelineReadEvent) => void }) {
  const { today, coach } = screen;
  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <CoachNotice screen={screen} onOpenCoach={onOpenCoach} />
      <View style={styles.todayHeader}>
        <Text style={styles.date}>{shortDate(today.date)}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="打开日历" hitSlop={10} onPress={onOpenCalendar}>
          <Text style={styles.calendarLink}>日历</Text>
        </Pressable>
      </View>
      <TodayCard today={today} onStartOnboarding={onStartOnboarding} onBeginWorkout={onBeginWorkout} onRecordActivity={onRecordActivity} onViewWorkoutSummary={onViewWorkoutSummary} />
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>今天</Text>
        <Text style={styles.sectionMeta}>{today.activityLog.entries.length ? `${today.activityLog.entries.length} 条记录` : ""}</Text>
      </View>
      <Timeline entries={today.activityLog.entries} onCorrect={onCorrectTimeline} />
      <Pressable accessibilityRole="button" onPress={onRecordActivity} style={styles.activityLogButton}><Text style={styles.activityLogButtonText}>记录今天</Text></Pressable>
      {coach.pending ? <CoachPending prompt={coach.pending.prompt} /> : null}
    </ScrollView>
  );
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

function TodayCard({ today, onStartOnboarding, onBeginWorkout, onRecordActivity, onViewWorkoutSummary }: { today: CoachProductProjection["today"]; onStartOnboarding: () => void; onBeginWorkout: () => void; onRecordActivity: () => void; onViewWorkoutSummary: (summary: WorkoutOutcomeProductSummary) => void }) {
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
        <Text style={styles.cardEyebrow}>今日计划</Text>
        <Text style={styles.planTitle} numberOfLines={2}>{today.session?.title ?? copy.title}</Text>
        <Text style={styles.planSubtitle} numberOfLines={1}>{copy.subtitle}</Text>
        <View style={styles.metricsRow}>
          <Metric value={today.session?.estimatedMinutes ? `${today.session.estimatedMinutes}′` : "—"} label="预计时长" />
          <Metric value={today.session ? String(today.session.totalSetCount || today.session.taskCount) : "—"} label={today.session?.kind === "cardio" ? "目标项目" : "工作组"} />
          <Metric value={today.activeWorkout?.status === "paused" ? "已暂停" : today.activeWorkout?.status === "active" ? "进行中" : today.session?.kind === "rest" ? "恢复" : ""} label="状态" />
        </View>
      </View>
      <View style={styles.taskArea}>
        {today.session?.tasks.length ? (
          <ScrollView nestedScrollEnabled showsVerticalScrollIndicator={false} contentContainerStyle={styles.taskScroll}>
            {today.session.tasks.map((task, index) => (
              <View style={styles.taskRow} key={task.id}>
                <Text numberOfLines={1} style={styles.taskName}>{task.label}</Text>
                <Text style={styles.taskSummary}>{task.summary}{task.targetRir !== undefined ? ` · RIR ${task.targetRir}` : ""}</Text>
                {index < today.session!.tasks.length - 1 ? <View style={styles.rowDivider} /> : null}
              </View>
            ))}
          </ScrollView>
        ) : (
          <View style={styles.planEmpty}><Text style={styles.planEmptyText}>{copy.empty}</Text></View>
        )}
      </View>
      <View style={styles.cardFooter}>
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: !canTakeAction }} disabled={!canTakeAction} onPress={takeAction} style={[styles.primaryButton, !canTakeAction && styles.primaryButtonDisabled]}>
          <Text style={styles.primaryButtonText}>{copy.action}</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** The initial mode is a user intent, persisted on the shared WorkoutSession. */
function WorkoutStartChoice({
  session,
  onChoose,
  onDismiss,
}: {
  session: ProductSession;
  onChoose: (mode: WorkoutStartMode) => void;
  onDismiss: () => void;
}) {
  return (
    <View accessibilityViewIsModal style={styles.startChoiceScrim}>
      <Pressable accessibilityRole="button" accessibilityLabel="关闭训练方式选择" onPress={onDismiss} style={StyleSheet.absoluteFill} />
      <View style={styles.startChoiceSheet}>
        <View style={styles.sheetHandle} />
        <Text style={styles.cardEyebrow}>开始训练</Text>
        <Text style={styles.startChoiceTitle}>{session.title}</Text>
        <Text style={styles.startChoiceSub}>可随时切换，已完成内容会保留在同一场训练中。</Text>
        <Pressable accessibilityRole="button" onPress={() => onChoose("record_only")} style={styles.startChoicePrimary}>
          <Text style={styles.startChoicePrimaryTitle}>直接记录</Text>
          <Text style={styles.startChoicePrimarySub}>按组确认实际次数、重量与感受</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => onChoose("coach_monitor")} style={styles.startChoiceSecondary}>
          <Text style={styles.startChoiceSecondaryTitle}>开启教练监控</Text>
          <Text style={styles.startChoiceSecondarySub}>相机只在支持的动作与机位下请求使用</Text>
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
        <Text style={styles.outcomeTitle}>{summary.title}</Text>
        <Text style={styles.outcomeStatus}>{outcomeStatusLabel(summary.status)}</Text>
        <View style={styles.outcomeMetricRow}>
          <OutcomeMetric value={String(summary.completedWorkSets)} label="完成工作组" />
          <OutcomeMetric value={String(summary.incompleteSetCount)} label="未完成组" />
          <OutcomeMetric value={outcomeCompletenessLabel(summary.dataCompleteness)} label="记录来源" />
        </View>
        <View style={styles.outcomeFacts}>
          <View style={styles.outcomeFactRow}><Text style={styles.outcomeFactLabel}>计划日期</Text><Text style={styles.outcomeFactValue}>{shortDate(summary.scheduledFor)}</Text></View>
          <View style={styles.outcomeFactRow}><Text style={styles.outcomeFactLabel}>实际结束</Text><Text style={styles.outcomeFactValue}>{summary.completedAt.slice(0, 16).replace("T", " ")}</Text></View>
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
  onDismiss,
  onSaved,
}: {
  application: CoachApplication;
  userId: string;
  onDismiss: () => void;
  onSaved: () => void;
}) {
  const [entryMode, setEntryMode] = useState<"activity" | "nutrition" | "sleep" | "recovery" | "body">("activity");
  const [activityType, setActivityType] = useState("散步");
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
    <View accessibilityViewIsModal style={styles.logScrim}>
      <Pressable accessibilityRole="button" accessibilityLabel="关闭活动记录" onPress={onDismiss} style={StyleSheet.absoluteFill} />
      <View style={styles.logSheet}>
        <View style={styles.sheetHandle} />
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
      </View>
    </View>
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

function CalendarScreen(props: {
  screen: CoachProductProjection;
  onSelectDate: (date: string) => void;
  onPrevious: () => void;
  onNext: () => void;
  onToggleMode: () => void;
  onViewWorkoutSummary: (summary: WorkoutOutcomeProductSummary) => void;
  onCorrectTimeline: (entry: TimelineReadEvent) => void;
}) {
  const { calendar } = props.screen;
  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.screenHeader}>
        <View><Text style={styles.screenTitle}>日历</Text><Text style={styles.screenSub}>{calendar.mode === "week" ? "本周安排" : "本月记录"}</Text></View>
        <View style={styles.calendarHeaderActions}><Pressable accessibilityRole="button" accessibilityLabel="查看上一段日历" onPress={props.onPrevious} style={styles.calendarStep}><Text style={styles.calendarStepText}>‹</Text></Pressable><Pressable accessibilityRole="button" onPress={props.onToggleMode} style={styles.modeButton}><Text style={styles.modeButtonText}>{calendar.mode === "week" ? "月" : "周"}</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel="查看下一段日历" onPress={props.onNext} style={styles.calendarStep}><Text style={styles.calendarStepText}>›</Text></Pressable></View>
      </View>
      <View style={[styles.calendarGrid, calendar.mode === "week" && styles.calendarGridWeek]}>
        {calendar.dates.map((day) => {
          const selected = day.date === calendar.selectedDate;
          return (
            <Pressable key={day.date} accessibilityRole="button" accessibilityLabel={`查看 ${day.date}`} onPress={() => props.onSelectDate(day.date)} style={[styles.calendarCell, selected && styles.calendarCellSelected]}>
              <Text style={[styles.calendarDay, selected && styles.calendarDaySelected]}>{Number(day.date.slice(-2))}</Text>
              <View style={styles.calendarMarks}>
                {day.planned ? <View style={styles.markPlanned} /> : null}
                {day.completed ? <View style={styles.markCompleted} /> : null}
                {day.partial ? <View style={styles.markPartial} /> : null}
                {day.hasActivityLog ? <View style={styles.markLog} /> : null}
              </View>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.detailCard}>
        <Text style={styles.cardEyebrow}>{shortDate(calendar.selected.date)}</Text>
        <Text style={styles.detailTitle}>{calendar.selected.session?.title ?? "当天记录"}</Text>
        {calendar.selected.session ? <Text style={styles.detailMeta}>{sessionMeta(calendar.selected.session)}</Text> : null}
        {calendar.selected.performedWorkouts.map((summary) => (
          <Pressable key={summary.id} accessibilityRole="button" accessibilityLabel={`查看 ${summary.title} 的训练结果`} onPress={() => props.onViewWorkoutSummary(summary)} style={styles.performedWorkoutRow}>
            <View style={styles.performedWorkoutCopy}>
              <Text style={styles.performedWorkoutTitle}>{summary.title}</Text>
              <Text style={styles.performedWorkoutMeta}>{outcomeStatusLabel(summary.status)} · {summary.completedWorkSets} 组完成 · {summary.completedAt.slice(11, 16)}</Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        ))}
        <Timeline entries={calendar.selected.activityLog.entries} compact onCorrect={props.onCorrectTimeline} />
      </View>
    </ScrollView>
  );
}

function PlanScreen({ application, userId, screen, onUpdated }: { application: CoachApplication; userId: string; screen: CoachProductProjection; onUpdated: () => void }) {
  const { plan } = screen;
  const [managingExercises, setManagingExercises] = useState(false);
  const [previewOverride, setPreviewOverride] = useState<EvidenceBriefArtifact>();
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState<string>();
  const preview = previewOverride ?? plan.latestPlanningPreview;
  const confirmPreview = async () => {
    if (!preview?.planningPreview || preview.planningPreview.status !== "awaiting_confirmation") return;
    setPreviewBusy(true);
    try {
      await application.confirmPlanningPreview({ userId, previewId: preview.id, idempotencyKey: `mobile-plan-preview:confirm:${preview.id}` });
      setPreviewOverride(undefined);
      setPreviewError(undefined);
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
      const next = await application.recomputePlanningPreview({ userId, previewId: preview.id, idempotencyKey: `mobile-plan-preview:recompute:${preview.id}` });
      setPreviewOverride(next);
      setPreviewError(undefined);
    } catch (cause) {
      setPreviewError(cause instanceof Error ? cause.message : "暂时无法重新计算预览");
    } finally {
      setPreviewBusy(false);
    }
  };
  if (preview?.planningPreview && preview.planningPreview.status !== "confirmed") {
    return <PlanningPreviewScreen preview={preview} busy={previewBusy} error={previewError} onConfirm={() => void confirmPreview()} onReject={() => void rejectPreview()} onRecompute={() => void recomputePreview()} />;
  }
  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.screenHeader}>
        <View><Text style={styles.screenTitle}>计划</Text><Text style={styles.screenSub}>{plan.revision ? `当前版本 r${plan.revision}` : "尚未生成"}</Text></View>
        <Pressable accessibilityRole="button" accessibilityLabel="管理动作" onPress={() => setManagingExercises(true)} style={styles.modeButton}><Text style={styles.modeButtonText}>动作</Text></Pressable>
      </View>
      {plan.status === "unavailable" ? <Empty label="完成建档后，这里会显示当前周期与本周安排。" /> : null}
      {plan.status === "stale" ? <Empty label="目标已更新，当前计划需要重新生成。" /> : null}
      {plan.strategySelection ? <View style={styles.detailCard}>
        <Text style={styles.cardEyebrow}>当前策略</Text>
        <Text style={styles.detailTitle}>{strategyLabel(plan.strategySelection.primary)}</Text>
        <Text style={styles.detailMeta}>{plan.appliedPhaseStrategy?.objective ?? "根据你的目标、历史与恢复边界生成"}</Text>
        <View style={styles.planForecastRow}>
          {plan.forecasts.map((forecast) => <View key={forecast.scenario} style={styles.planForecastItem}>
            <Text style={styles.planForecastName}>{forecastScenarioLabel(forecast.scenario)}</Text>
            <Text style={styles.planForecastMeta}>{forecast.eligibility === "eligible" ? "可选" : forecast.eligibility === "degraded" ? "降级" : "不可用"}</Text>
            <Text style={styles.planForecastDate}>{forecast.earliest}–{forecast.latest}</Text>
            <Text style={styles.planForecastDate}>置信度 {Math.round(forecast.confidence.min * 100)}–{Math.round(forecast.confidence.max * 100)}%</Text>
          </View>)}
        </View>
        {plan.forecasts.map((forecast) => <Text key={`${forecast.scenario}:detail`} style={styles.detailMeta}>{forecastScenarioLabel(forecast.scenario)} · 执行 {forecast.executionRequirements.join("、")} · 代价 {forecast.tradeoffs.join("、")} · 护栏 {forecast.guardrails.join("、")} · 复核 {forecast.recalibrateAt}</Text>)}
        <Text style={styles.planFootnote}>预测会在真实趋势与周期复核后重新校准；不是结果保证。</Text>
      </View> : null}
      {plan.explanation ? <View style={styles.detailCard}>
        <Text style={styles.cardEyebrow}>依据与未知</Text>
        <Text style={styles.detailMeta}>个人事实：{plan.explanation.userEvidence.join("、")}</Text>
        <Text style={styles.detailMeta}>规则：{plan.explanation.ruleReason.join("、")}</Text>
        {plan.explanation.researchEvidence.map((citation) => <Text key={citation.citationId} style={styles.detailMeta}>本地依据：{citation.citationId} · {citation.claim} · 适用 {citation.population} · 局限 {citation.limitation}</Text>)}
        <Text style={styles.detailMeta}>未知：{plan.explanation.uncertainty.join("、")}</Text>
      </View> : null}
      {plan.currentWeek.map((session) => <PlanSession key={session.id} session={session} />)}
      {plan.nextWeek.length ? <Text style={styles.sectionTitle}>下一周</Text> : null}
      {plan.nextWeek.map((session) => <PlanSession key={session.id} session={session} subdued />)}
      {plan.futureIntentCount ? <Text style={styles.planFootnote}>后续 {plan.futureIntentCount} 项仍是周期意图，会在临近时物化。</Text> : null}
      {managingExercises ? <ExerciseManager application={application} userId={userId} onDismiss={() => setManagingExercises(false)} /> : null}
    </ScrollView>
  );
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
          <View><Text style={styles.logTitle}>我的动作</Text><Text style={styles.exerciseManagerSub}>只管理你自己新增的动作；未知信息不会被当作训练事实。</Text></View>
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
  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.screenHeader}><View><Text style={styles.screenTitle}>进展</Text><Text style={styles.screenSub}>来自已确认的记录</Text></View></View>
      <View style={styles.progressGrid}>
        <ProgressMetric label="完成训练" value={String(screen.progress.completedWorkoutCount)} meta="已结束 Session" />
        <ProgressMetric label="体重" value={trendValue(weight?.smoothedPoints.at(-1)?.smoothedValue, weight?.rawPoints.at(-1)?.unit)} meta={trendCoverage(weight?.coverage.observations)} />
        <ProgressMetric label="体脂" value={trendValue(bodyFat?.smoothedPoints.at(-1)?.smoothedValue, bodyFat?.rawPoints.at(-1)?.unit)} meta={trendCoverage(bodyFat?.coverage.observations)} />
      </View>
      <Text style={styles.sectionTitle}>训练视频</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="打开训练视频" onPress={onOpenVideoLibrary} style={styles.videoLibraryCard}>
        <View><Text style={styles.videoLibraryTitle}>本机视频库</Text><Text style={styles.videoLibraryMeta}>回放已录制的动作，并在本地重新识别</Text></View><Text style={styles.videoLibraryArrow}>›</Text>
      </Pressable>
      <Text style={styles.sectionTitle}>报告</Text>
      {screen.progress.reportArtifacts.length ? screen.progress.reportArtifacts.map((artifact) => (
        <View key={artifact.id} style={styles.reportRow}>
          <Text style={styles.reportTitle}>{artifact.kind === "weekly_coach_report" ? "每周回顾" : artifact.kind === "goal_forecast" ? "目标路径" : artifact.kind === "mesocycle_review" ? "周期回顾" : "计划复核"}</Text>
          <Text style={styles.reportMeta}>{artifact.createdAt.slice(0, 10)}</Text>
        </View>
      )) : <Empty label="积累一些训练与生活记录后，这里会出现趋势和报告。" />}
    </ScrollView>
  );
}

function ProfileScreen({ application, userId, screen, onStartOnboarding, onUpdated }: { application: CoachApplication; userId: string; screen: CoachProductProjection; onStartOnboarding: () => void; onUpdated: () => void }) {
  const profile = screen.profile;
  const [showPermissions, setShowPermissions] = useState(false);
  const [showPrivacyDetails, setShowPrivacyDetails] = useState(false);
  const [showActionLog, setShowActionLog] = useState(false);
  const [showCoachMemory, setShowCoachMemory] = useState(false);
  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.screenHeader}><View><Text style={styles.screenTitle}>我的</Text><Text style={styles.screenSub}>{profile.onboardingComplete ? "资料与权限" : "开始建立资料"}</Text></View></View>
      {!profile.onboardingComplete ? <Pressable accessibilityRole="button" onPress={onStartOnboarding} style={styles.profileStart}><Text style={styles.profileStartText}>开始建档</Text></Pressable> : null}
      <View style={styles.profileCard}>
        <ProfileRow label="训练经验" value={profile.trainingExperience ?? "待填写"} />
        <ProfileRow label="当前目标" value={goalLabel(profile.primaryGoal)} />
        <ProfileRow label="教练权限" value={mandateLabel(profile.mandateMode)} />
        <ProfileRow label="训练地点" value={`${profile.locations} 个`} />
        <ProfileRow label="自定义动作" value={`${profile.customExercises} 个`} />
      </View>
      <Text style={styles.sectionTitle}>Coach 记忆</Text>
      <CoachMemoryPanel application={application} userId={userId} onOpen={() => setShowCoachMemory(true)} />
      <Text style={styles.sectionTitle}>权限</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="管理数据与权限" onPress={() => setShowPermissions(true)} style={styles.profileCard}>
        {profile.permissions ? (
          <>
            <ProfileRow label="相机" value={permissionLabel(profile.permissions.camera)} />
            <ProfileRow label="健康数据" value={permissionLabel(profile.permissions.health)} />
            <ProfileRow label="通知" value={permissionLabel(profile.permissions.notifications)} />
            <ProfileRow label="远程模型" value={permissionLabel(profile.permissions.remoteLlm)} />
            <ProfileRow label="同步" value={permissionLabel(profile.permissions.cloudSync)} />
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
      <Text style={styles.sectionTitle}>健康数据</Text>
      <HealthConnectionPanel application={application} userId={userId} permissions={profile.permissions} sources={profile.healthSources} onUpdated={onUpdated} />
      <Text style={styles.sectionTitle}>Coach 提醒</Text>
      <RecipeReminderSettings application={application} userId={userId} onUpdated={onUpdated} />
      <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>Coach 操作</Text><Pressable accessibilityRole="button" accessibilityLabel="查看全部 Coach 操作" onPress={() => setShowActionLog(true)}><Text style={styles.sectionLink}>查看全部</Text></Pressable></View>
      <View style={styles.profileCard}>
        {profile.actionLog.recent.length ? profile.actionLog.recent.map((entry) => <View key={entry.id} style={styles.actionLogRow}><View style={styles.actionLogBody}><Text style={styles.actionLogTitle}>{actionLabel(entry.action)}</Text><Text style={styles.actionLogMeta}>{entry.actor === "agent" ? "Coach" : entry.actor === "rule_engine" ? "本地规则" : "你"} · {actionResultLabel(entry.result)} · {entry.occurredAt.slice(5, 16)}</Text></View></View>) : <Text style={styles.emptyText}>还没有需要追溯的 Coach 操作。</Text>}
      </View>
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
  return <View style={styles.permissionScrim}>
    <View style={styles.privacySheet}>
      <View style={styles.sheetHandle} />
      <View style={styles.exerciseManagerHeader}>
        <View><Text style={styles.logTitle}>账号与数据</Text><Text style={styles.exerciseManagerSub}>本机记录、同步和远程模型是相互独立的选择。</Text></View>
        <Pressable accessibilityRole="button" accessibilityLabel="关闭账号与数据" onPress={onDismiss} style={styles.exerciseClose}><Text style={styles.exerciseCloseText}>完成</Text></Pressable>
      </View>
      {error ? <Text style={styles.formError}>{error}</Text> : overview === undefined ? <View style={styles.privacySheetLoading}><ActivityIndicator color={colors.limeDeep} /></View> : <ScrollView contentContainerStyle={styles.privacyDetailList}>
        <PrivacyDetailBlock title="账号" summary={privacyAccountLabel(overview)}>
          <Text style={styles.privacyDetailText}>{privacyAccountDetail(overview)}</Text>
        </PrivacyDetailBlock>
        <PrivacyDetailBlock title="同步" summary={privacySyncLabel(overview)}>
          <Text style={styles.privacyDetailText}>{privacySyncDetail(overview)}</Text>
        </PrivacyDetailBlock>
        <ReplicaSyncStatus application={application} userId={userId} refreshKey={refreshKey} />
        <PrivacyDetailBlock title="远程模型" summary={privacyRemoteModelLabel(overview)}>
          <Text style={styles.privacyDetailText}>远程模型只会在你允许后，为当前任务接收相关的{overview.remoteModel.consent.includedCategories.join("、")}语义。</Text>
          <Text style={styles.privacyDetailText}>发送前会移除{overview.remoteModel.consent.removedDirectIdentityFields.join("、")}。</Text>
          {overview.remoteModel.configuration.status === "ready" ? <Text style={styles.privacyDetailMeta}>已配置 {overview.remoteModel.configuration.provider} · {overview.remoteModel.configuration.model} · {overview.remoteModel.configuration.endpointHost}</Text> : overview.remoteModel.configuration.status === "credential_unavailable" ? <Text style={styles.privacyDetailMeta}>服务设置仍在本机，但系统安全存储中的凭据暂不可用；不会发起远程请求。</Text> : <Text style={styles.privacyDetailMeta}>尚未配置服务；即使已授权，也会继续使用本机 Coach。</Text>}
          {overview.remoteModel.consent.status === "active" ? <Text style={styles.privacyDetailMeta}>已于 {overview.remoteModel.consent.grantedAt.slice(0, 16).replace("T", " ")} 确认</Text> : overview.remoteModel.consent.status === "review_required" ? <Text style={styles.privacyDetailMeta}>授权信息需要重新确认后才能用于远程请求。</Text> : <Text style={styles.privacyDetailMeta}>未启用时不会发起远程模型请求。</Text>}
        </PrivacyDetailBlock>
        <PrivacyDetailBlock title="本机媒体" summary={privacyMediaLabel(overview)}>
          <Text style={styles.privacyDetailText}>当前媒体只保留在本机，不会因为开启同步而自动上传。</Text>
          <Text style={styles.privacyDetailMeta}>{privacyMediaProtectionDetail(overview)}</Text>
        </PrivacyDetailBlock>
        {canManagePermissions ? <Pressable accessibilityRole="button" accessibilityLabel="管理数据授权" onPress={onManagePermissions} style={styles.privacyManageButton}><Text style={styles.privacyManageButtonText}>管理授权</Text></Pressable> : null}
      </ScrollView>}
    </View>
  </View>;
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
  return <View style={styles.profileCard}>
    <Text style={styles.healthConnectionNote}>这些是本机的提醒类别；系统通知权限与安静时段会在实际投递前再次生效。</Text>
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
  return <View style={styles.actionLogScrim}><View style={styles.actionLogSheet}><View style={styles.sheetHandle} /><View style={styles.exerciseManagerHeader}><View><Text style={styles.logTitle}>Coach 操作</Text><Text style={styles.exerciseManagerSub}>这是操作轨迹，不是你的训练 Timeline。撤销会保留原记录并创建补偿版本。</Text></View><Pressable accessibilityRole="button" accessibilityLabel="关闭 Coach 操作" onPress={onDismiss} style={styles.exerciseClose}><Text style={styles.exerciseCloseText}>完成</Text></Pressable></View><ScrollView contentContainerStyle={styles.actionLogList}>{error ? <Text style={styles.formError}>{error}</Text> : events === undefined ? <ActivityIndicator color={colors.limeDeep} /> : events.length ? events.map((event) => <View key={event.id} style={styles.actionLogDetailRow}><View style={styles.actionLogDetailTop}><Text style={styles.actionLogTitle}>{actionLabel(event.action)}</Text><Text style={styles.actionLogResult}>{actionResultLabel(event.result)}</Text></View><Text style={styles.actionLogDetailMeta}>{actorLabel(event.actor)} · {event.occurredAt.slice(0, 16).replace("T", " ")}</Text><Text style={styles.actionLogIntent}>{event.intent}</Text>{event.beforeRevision !== undefined || event.afterRevision !== undefined ? <Text style={styles.actionLogDetailMeta}>版本 {event.beforeRevision ?? "—"} → {event.afterRevision ?? "—"}</Text> : null}{event.reversible && !event.undoneBy ? <Text style={styles.actionLogReversible}>可通过原卡片撤销</Text> : null}</View>) : <Text style={styles.exerciseEmpty}>还没有记录。实际训练、饮食和恢复会在 Timeline 中查看。</Text>}</ScrollView></View></View>;
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
  return <Pressable accessibilityRole="button" accessibilityLabel="管理 Coach 记忆" onPress={onOpen} style={styles.profileCard}>
    <View style={styles.privacySummaryFooter}>
      <View><Text style={styles.profileLabel}>本机备忘</Text><Text style={styles.exerciseManagerSub}>不会自动改写资料、Timeline 或计划</Text></View>
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
      <View style={styles.exerciseManagerHeader}><View><Text style={styles.logTitle}>Coach 记忆</Text><Text style={styles.exerciseManagerSub}>这是可管理的本机备忘，不是你的档案、真实经历或自动执行指令。</Text></View><Pressable accessibilityRole="button" accessibilityLabel="关闭 Coach 记忆" onPress={onDismiss} style={styles.exerciseClose}><Text style={styles.exerciseCloseText}>完成</Text></Pressable></View>
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
type PermissionSettingsKey = Exclude<keyof PermissionSettingsValue, "revision" | "id" | "remoteLlmDisclosure">;

const permissionSettings: readonly { key: PermissionSettingsKey; label: string; description: string }[] = [
  { key: "camera", label: "相机", description: "只在你主动进入监控或录像时再请求系统相机权限。" },
  { key: "health", label: "健康数据", description: "可连接系统健康数据；拒绝后仍能手动记录。" },
  { key: "notifications", label: "提醒", description: "用于本地训练与恢复提醒；系统通知权限会单独确认。" },
  { key: "remoteLlm", label: "远程模型", description: "发送任务相关训练与经历内容；姓名和联系方式等直接身份字段会被移除。" },
  { key: "cloudSync", label: "同步", description: "启用后才允许把本地副本与已登录设备同步。" },
  { key: "mediaUpload", label: "照片分析", description: "每次发送食物图片前都会让你确认；识别结果先是草稿。" },
];

function PermissionSettings({ application, userId, permissions, onDismiss, onUpdated }: { application: CoachApplication; userId: string; permissions: PermissionSettingsValue; onDismiss: () => void; onUpdated: () => void }) {
  const [busy, setBusy] = useState<PermissionSettingsKey>();
  const [error, setError] = useState<string>();
  const [showRemoteModelSetup, setShowRemoteModelSetup] = useState(false);
  const [remoteProvider, setRemoteProvider] = useState<Awaited<ReturnType<CoachApplication["readLocalRemoteLlmProviderSettings"]>>();
  useEffect(() => {
    let active = true;
    void application.readLocalRemoteLlmProviderSettings(userId).then((next) => {
      if (active) setRemoteProvider(next);
    }).catch(() => {
      if (active) setRemoteProvider(undefined);
    });
    return () => { active = false; };
  }, [application, permissions.revision, userId]);
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
    if (key === "remoteLlm" && !enabled && !remoteProvider?.provider) {
      setShowRemoteModelSetup(true);
      return;
    }
    void setPermission(key, enabled ? "denied" : "granted");
  };
  return (
    <View style={styles.permissionScrim}>
      <View style={styles.permissionSheet}>
        <View style={styles.sheetHandle} />
        <View style={styles.exerciseManagerHeader}><View><Text style={styles.logTitle}>数据与权限</Text><Text style={styles.exerciseManagerSub}>本地授权独立保存。真正启用设备能力时，系统仍会按需再次确认。</Text></View><Pressable accessibilityRole="button" accessibilityLabel="关闭数据与权限" onPress={onDismiss} style={styles.exerciseClose}><Text style={styles.exerciseCloseText}>完成</Text></Pressable></View>
        <ScrollView contentContainerStyle={styles.permissionList}>
          {permissionSettings.map((setting) => {
            const value = permissions[setting.key];
            const enabled = value === "granted";
            return <View key={setting.key} style={styles.permissionRow}><View style={styles.permissionBody}><Text style={styles.permissionTitle}>{setting.label}</Text><Text style={styles.permissionDescription}>{setting.description}</Text>{setting.key === "remoteLlm" ? <Pressable accessibilityRole="button" accessibilityLabel="配置远程模型" disabled={busy !== undefined} onPress={() => setShowRemoteModelSetup(true)}><Text style={permissionConfigureStyles.text}>{remoteProvider?.provider ? "更新服务设置" : "配置服务"}</Text></Pressable> : null}</View><Pressable accessibilityRole="switch" accessibilityState={{ checked: enabled, disabled: busy !== undefined }} disabled={busy !== undefined} onPress={() => toggle(setting.key, enabled)} style={[styles.permissionSwitch, enabled && styles.permissionSwitchOn, busy === setting.key && styles.primaryButtonDisabled]}><View style={[styles.permissionKnob, enabled && styles.permissionKnobOn]} /></Pressable></View>;
          })}
          {error ? <Text style={styles.formError}>{error}</Text> : null}
        </ScrollView>
        {showRemoteModelSetup ? <RemoteModelSetupSheet application={application} userId={userId} permissions={permissions} configured={remoteProvider?.provider} onDismiss={() => setShowRemoteModelSetup(false)} onUpdated={() => { setShowRemoteModelSetup(false); onUpdated(); }} /> : null}
      </View>
    </View>
  );
}

function OnboardingScreen({ application, userId, onCompleted }: { application: CoachApplication; userId: string; onCompleted: () => void }) {
  const [experience, setExperience] = useState<"beginner" | "intermediate" | "advanced">("beginner");
  const [goal, setGoal] = useState<"hypertrophy" | "strength" | "fat_loss_preserve_lean_mass">("hypertrophy");
  const [goalType, setGoalType] = useState<"hypertrophy" | "fat_loss" | "strength" | "maintain" | "return_to_training">("hypertrophy");
  const [location, setLocation] = useState<"home" | "gym">("home");
  const [mode, setMode] = useState<"manual" | "collaborative" | "managed">("collaborative");
  const [age, setAge] = useState("");
  const [sex, setSex] = useState<"female" | "male" | "prefer_not_to_say" | "unknown">("unknown");
  const [height, setHeight] = useState("");
  const [weight, setWeight] = useState("");
  const [weeklyFrequency, setWeeklyFrequency] = useState("");
  const [sessionDuration, setSessionDuration] = useState("");
  const [nutritionCondition, setNutritionCondition] = useState("");
  const [showProfessional, setShowProfessional] = useState(false);
  const [squat, setSquat] = useState("");
  const [benchPress, setBenchPress] = useState("");
  const [deadlift, setDeadlift] = useState("");
  const [waist, setWaist] = useState("");
  const [neck, setNeck] = useState("");
  const [bodyFat, setBodyFat] = useState("");
  const [bodyFatMethod, setBodyFatMethod] = useState("");
  const [plateauWeeks, setPlateauWeeks] = useState("");
  const [priorStrategies, setPriorStrategies] = useState("");
  const [executionAdherence, setExecutionAdherence] = useState<"unknown" | "low" | "mixed" | "high">("unknown");
  const [recoveryChange, setRecoveryChange] = useState<"unknown" | "worse" | "stable" | "better">("unknown");
  const [adultConfirmed, setAdultConfirmed] = useState(false);
  const [noCurrentStopSignal, setNoCurrentStopSignal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [preview, setPreview] = useState<EvidenceBriefArtifact>();
  const onboardingDraftId = useRef<string>();
  const previewAttempt = useRef(0);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState<string>();
  const complete = async () => {
    if (!adultConfirmed || !noCurrentStopSignal) {
      setError("请先确认以上两项，再继续。");
      return;
    }
    const frequency = optionalFiniteNumber(weeklyFrequency);
    const duration = optionalFiniteNumber(sessionDuration);
    if (frequency === undefined || frequency <= 0 || duration === undefined || duration <= 0) {
      setError("请填写每周训练次数和单次时长；未知信息不会被系统猜测。");
      return;
    }
    setSaving(true);
    try {
      const date = localDate();
      const depth = showProfessional ? "professional" : "basic";
      const end = new Date(`${date}T12:00:00.000Z`);
      end.setUTCDate(end.getUTCDate() + 84);
      if (!onboardingDraftId.current) {
        const draft = await application.startOnboarding({ userId, depth });
        await application.saveOnboardingProgress({
          draftId: draft.id,
          inputMode: "form",
          idempotencyKey: `mobile-onboarding:${draft.id}:${depth}`,
          confirmedSections: ["profile", "goal", "mandate", "permissions", "safety", ...(showProfessional ? ["professional" as const] : [])],
          patch: {
          profile: {
            adultConfirmed: true,
            ...((optionalFiniteNumber(age) !== undefined || optionalFiniteNumber(height) !== undefined || optionalFiniteNumber(weight) !== undefined || sex !== "unknown")
              ? {
                  demographics: {
                    ...(optionalFiniteNumber(age) !== undefined ? { ageYears: optionalFiniteNumber(age) } : {}),
                    ...(sex !== "unknown" ? { sex } : {}),
                    ...(optionalFiniteNumber(height) !== undefined ? { height: { value: optionalFiniteNumber(height)!, unit: "cm" as const } } : {}),
                    ...(optionalFiniteNumber(weight) !== undefined ? { currentWeight: { value: optionalFiniteNumber(weight)!, unit: "kg" as const } } : {}),
                  },
                }
              : {}),
            trainingExperience: experience,
            returningStatus: "new",
            schedule: { weeklyFrequency: frequency, sessionDurationMinutes: duration },
            locations: [{
              id: `location:${location}`,
              kind: location,
              environment: { space: location === "home" ? "medium" : "large", noise: location === "home" ? "quiet" : "any" },
              availableEquipment: location === "home" ? ["bodyweight", "floor_space"] : ["full_gym"],
            }],
            bodyDirection: goal === "fat_loss_preserve_lean_mass" ? "decrease_body_fat" : goal === "hypertrophy" ? "gain_mass" : "performance_only",
            exerciseConstraints: [],
            nutritionPreferences: nutritionCondition.trim() ? [nutritionCondition.trim()] : [],
            professionalConstraints: [],
          },
          ...(showProfessional ? {
            professional: {
              ...(optionalFiniteNumber(squat) !== undefined || optionalFiniteNumber(benchPress) !== undefined || optionalFiniteNumber(deadlift) !== undefined
                ? {
                    strengthBaseline: {
                      ...(optionalFiniteNumber(squat) !== undefined ? { squat: { value: optionalFiniteNumber(squat)!, unit: "kg" as const } } : {}),
                      ...(optionalFiniteNumber(benchPress) !== undefined ? { benchPress: { value: optionalFiniteNumber(benchPress)!, unit: "kg" as const } } : {}),
                      ...(optionalFiniteNumber(deadlift) !== undefined ? { deadlift: { value: optionalFiniteNumber(deadlift)!, unit: "kg" as const } } : {}),
                      measuredAt: `${date}T12:00:00.000Z`,
                      source: "user_confirmed" as const,
                    },
                  }
                : {}),
              bodyObservations: [
                ...(optionalFiniteNumber(waist) !== undefined ? [{ occurredAt: `${date}T12:00:00.000Z`, metric: "circumference" as const, site: "waist", quantity: { value: optionalFiniteNumber(waist)!, unit: "cm" as const } }] : []),
                ...(optionalFiniteNumber(neck) !== undefined ? [{ occurredAt: `${date}T12:00:00.000Z`, metric: "circumference" as const, site: "neck", quantity: { value: optionalFiniteNumber(neck)!, unit: "cm" as const } }] : []),
                ...(optionalFiniteNumber(bodyFat) !== undefined ? [{ occurredAt: `${date}T12:00:00.000Z`, metric: "body_fat_percentage" as const, quantity: { value: optionalFiniteNumber(bodyFat)!, unit: "percent" as const }, condition: bodyFatMethod.trim() || "user_reported" }] : []),
              ],
              ...(optionalFiniteNumber(plateauWeeks) !== undefined || priorStrategies.trim() || executionAdherence !== "unknown" || recoveryChange !== "unknown" ? {
                plateauHistory: {
                  ...(optionalFiniteNumber(plateauWeeks) !== undefined ? { durationWeeks: optionalFiniteNumber(plateauWeeks) } : {}),
                  ...(priorStrategies.trim() ? { priorStrategies: priorStrategies.split(",").map((item) => item.trim()).filter(Boolean) } : {}),
                  executionAdherence,
                  recoveryChange,
                  suspectedReasons: [],
                },
              } : {}),
            },
          } : {}),
          goal: {
            primaryGoal: goal,
            goalType,
            expectedDirection: goal === "fat_loss_preserve_lean_mass" ? "decrease_body_fat_preserve_performance" : goal === "hypertrophy" ? "gain_lean_mass" : "increase_strength",
            horizon: { startDate: date, endDate: end.toISOString().slice(0, 10) },
          },
          mandate: {
            mode,
            scopes: {
              loadReps: mode === "managed" ? "managed_small_step" : mode === "manual" ? "manual" : "confirm",
              volume: mode === "managed" ? "managed_small_step" : mode === "manual" ? "manual" : "confirm",
              substitution: mode === "managed" ? "managed_small_step" : mode === "manual" ? "manual" : "confirm",
              schedule: mode === "managed" ? "managed_small_step" : mode === "manual" ? "manual" : "confirm",
              deload: mode === "managed" ? "managed_small_step" : mode === "manual" ? "manual" : "confirm",
              nutrition: mode === "managed" ? "managed_small_step" : mode === "manual" ? "advice_only" : "confirm",
            },
            limits: { maxLoadIncreasePercent: 5, maxWeeklySetChange: 2 },
            locks: [],
          },
          permissions: {
            camera: "not_configured",
            health: "not_configured",
            notifications: "not_configured",
            remoteLlm: "not_configured",
            cloudSync: "not_configured",
            mediaUpload: "not_configured",
          },
          safety: {
            adultConfirmed: true,
            professionalRestriction: false,
            recentSurgeryOrAcuteInjury: false,
            pregnancyOrPostpartumSpecialConsideration: false,
            eatingDisorderOrLowEnergyRiskDeclared: false,
            stopSignals: [],
          },
        });
        await application.completeOnboarding({ draftId: draft.id, idempotencyKey: `mobile-onboarding:${draft.id}:complete` });
        onboardingDraftId.current = draft.id;
        // Installs typed local recipes only. Nothing is scheduled or sent until
        // a matching local fact arrives and notification settings allow it.
        await application.ensureDefaultEventRecipes(userId);
      }
      previewAttempt.current += 1;
      const nextPreview = await application.createPlanningPreview({
        userId,
        currentDate: date,
        trigger: "initial_plan",
        idempotencyKey: `mobile-onboarding:${onboardingDraftId.current}:preview:${previewAttempt.current}`,
      });
      setPreview(nextPreview);
      setPreviewError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "暂时无法保存资料");
    } finally {
      setSaving(false);
    }
  };
  const confirmPreview = async () => {
    if (!preview?.planningPreview) return;
    setPreviewBusy(true);
    try {
      await application.confirmPlanningPreview({
        userId,
        previewId: preview.id,
        idempotencyKey: `mobile-onboarding:${onboardingDraftId.current}:confirm:${preview.id}`,
      });
      onCompleted();
    } catch (cause) {
      setPreviewError(cause instanceof Error ? cause.message : "预览已变化，请重新计算");
    } finally {
      setPreviewBusy(false);
    }
  };
  const rejectPreview = async () => {
    if (!preview?.planningPreview) return;
    setPreviewBusy(true);
    try {
      await application.rejectPlanningPreview({
        userId,
        previewId: preview.id,
        idempotencyKey: `mobile-onboarding:${onboardingDraftId.current}:reject:${preview.id}`,
      });
      onCompleted();
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
      previewAttempt.current += 1;
      const nextPreview = await application.recomputePlanningPreview({
        userId,
        previewId: preview.id,
        idempotencyKey: `mobile-onboarding:${onboardingDraftId.current}:recompute:${previewAttempt.current}`,
      });
      setPreview(nextPreview);
      setPreviewError(undefined);
    } catch (cause) {
      setPreviewError(cause instanceof Error ? cause.message : "暂时无法重新计算预览");
    } finally {
      setPreviewBusy(false);
    }
  };
  if (preview) {
    return <PlanningPreviewScreen preview={preview} busy={previewBusy} error={previewError} onConfirm={() => void confirmPreview()} onReject={() => void rejectPreview()} onRecompute={() => void recomputePreview()} />;
  }
  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.screenHeader}><View><Text style={styles.screenTitle}>建立资料</Text><Text style={styles.screenSub}>先从几项基础信息开始</Text></View></View>
      <Question label="训练经验" options={[{ id: "beginner", label: "刚开始" }, { id: "intermediate", label: "有规律训练" }, { id: "advanced", label: "进阶训练" }]} selected={experience} onSelect={setExperience} />
      <Text style={styles.questionLabel}>基础身体资料（可留空，未知不会被猜测）</Text>
      <View style={styles.onboardingFields}>
        <TextInput value={age} onChangeText={setAge} keyboardType="number-pad" placeholder="年龄" placeholderTextColor={colors.ink3} style={styles.onboardingInput} />
        <TextInput value={height} onChangeText={setHeight} keyboardType="decimal-pad" placeholder="身高 cm" placeholderTextColor={colors.ink3} style={styles.onboardingInput} />
        <TextInput value={weight} onChangeText={setWeight} keyboardType="decimal-pad" placeholder="体重 kg" placeholderTextColor={colors.ink3} style={styles.onboardingInput} />
      </View>
      <Question label="性别（可留空）" options={[{ id: "female", label: "女性" }, { id: "male", label: "男性" }, { id: "prefer_not_to_say", label: "不填写" }, { id: "unknown", label: "未知" }]} selected={sex} onSelect={setSex} />
      <Text style={styles.questionLabel}>每周安排与饮食条件</Text>
      <View style={styles.onboardingFields}>
        <TextInput value={weeklyFrequency} onChangeText={setWeeklyFrequency} keyboardType="number-pad" placeholder="每周次数" placeholderTextColor={colors.ink3} style={styles.onboardingInput} />
        <TextInput value={sessionDuration} onChangeText={setSessionDuration} keyboardType="number-pad" placeholder="单次分钟" placeholderTextColor={colors.ink3} style={styles.onboardingInput} />
      </View>
      <TextInput value={nutritionCondition} onChangeText={setNutritionCondition} placeholder="饮食条件（可选，例如外食 / 自己做饭）" placeholderTextColor={colors.ink3} style={styles.onboardingInput} />
      <Pressable accessibilityRole="button" onPress={() => setShowProfessional((value) => !value)} style={styles.professionalToggle}><Text style={styles.professionalToggleText}>{showProfessional ? "收起专业资料" : "补充专业资料（可选）"}</Text></Pressable>
      {showProfessional ? <View style={styles.professionalFields}>
        <Text style={styles.questionLabel}>力量基线（kg，可留空）</Text>
        <View style={styles.onboardingFields}>
          <TextInput value={squat} onChangeText={setSquat} keyboardType="decimal-pad" placeholder="深蹲" placeholderTextColor={colors.ink3} style={styles.onboardingInput} />
          <TextInput value={benchPress} onChangeText={setBenchPress} keyboardType="decimal-pad" placeholder="卧推" placeholderTextColor={colors.ink3} style={styles.onboardingInput} />
          <TextInput value={deadlift} onChangeText={setDeadlift} keyboardType="decimal-pad" placeholder="硬拉" placeholderTextColor={colors.ink3} style={styles.onboardingInput} />
        </View>
        <Text style={styles.questionLabel}>围度与体脂（可留空）</Text>
        <View style={styles.onboardingFields}>
          <TextInput value={waist} onChangeText={setWaist} keyboardType="decimal-pad" placeholder="腰围 cm" placeholderTextColor={colors.ink3} style={styles.onboardingInput} />
          <TextInput value={neck} onChangeText={setNeck} keyboardType="decimal-pad" placeholder="颈围 cm" placeholderTextColor={colors.ink3} style={styles.onboardingInput} />
          <TextInput value={bodyFat} onChangeText={setBodyFat} keyboardType="decimal-pad" placeholder="体脂 %" placeholderTextColor={colors.ink3} style={styles.onboardingInput} />
        </View>
        <TextInput value={bodyFatMethod} onChangeText={setBodyFatMethod} placeholder="体脂来源 / 方法，例如 DEXA、皮脂钳、用户自测" placeholderTextColor={colors.ink3} style={styles.onboardingInput} />
        <Text style={styles.questionLabel}>平台与往期策略（可留空）</Text>
        <View style={styles.onboardingFields}>
          <TextInput value={plateauWeeks} onChangeText={setPlateauWeeks} keyboardType="number-pad" placeholder="平台周数" placeholderTextColor={colors.ink3} style={styles.onboardingInput} />
          <TextInput value={priorStrategies} onChangeText={setPriorStrategies} placeholder="往期策略，用逗号分隔" placeholderTextColor={colors.ink3} style={[styles.onboardingInput, { flex: 2 }]} />
        </View>
        <Question label="执行情况" options={[{ id: "unknown", label: "未知" }, { id: "low", label: "低" }, { id: "mixed", label: "不稳定" }, { id: "high", label: "高" }]} selected={executionAdherence} onSelect={setExecutionAdherence} />
        <Question label="恢复变化" options={[{ id: "unknown", label: "未知" }, { id: "worse", label: "变差" }, { id: "stable", label: "稳定" }, { id: "better", label: "变好" }]} selected={recoveryChange} onSelect={setRecoveryChange} />
      </View> : null}
      <Question label="现在最想达成" options={[{ id: "hypertrophy", label: "增肌" }, { id: "strength", label: "增力" }, { id: "fat_loss_preserve_lean_mass", label: "减脂保肌" }]} selected={goal} onSelect={(next) => { setGoal(next); setGoalType(next === "fat_loss_preserve_lean_mass" ? "fat_loss" : next); }} />
      <Question label="目标阶段意图" options={[{ id: "hypertrophy", label: "增肌" }, { id: "fat_loss", label: "减脂" }, { id: "strength", label: "增力" }, { id: "maintain", label: "维持重组" }, { id: "return_to_training", label: "重返训练" }]} selected={goalType} onSelect={setGoalType} />
      <Question label="主要在哪里训练" options={[{ id: "home", label: "家里 / 徒手" }, { id: "gym", label: "健身房" }]} selected={location} onSelect={setLocation} />
      <Question label="计划权限" options={[{ id: "manual", label: "我自己调整" }, { id: "collaborative", label: "一起确认" }, { id: "managed", label: "保守托管" }]} selected={mode} onSelect={setMode} />
      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: adultConfirmed }} onPress={() => setAdultConfirmed((value) => !value)} style={styles.confirmRow}><View style={[styles.checkbox, adultConfirmed && styles.checkboxOn]}>{adultConfirmed ? <Text style={styles.checkboxMark}>✓</Text> : null}</View><Text style={styles.confirmText}>我已成年，并愿意根据自身情况决定是否训练。</Text></Pressable>
      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: noCurrentStopSignal }} onPress={() => setNoCurrentStopSignal((value) => !value)} style={styles.confirmRow}><View style={[styles.checkbox, noCurrentStopSignal && styles.checkboxOn]}>{noCurrentStopSignal ? <Text style={styles.checkboxMark}>✓</Text> : null}</View><Text style={styles.confirmText}>当前没有需要立即停止运动的症状或专业人员限制。</Text></Pressable>
      {error ? <Text style={styles.formError}>{error}</Text> : null}
      <Pressable accessibilityRole="button" disabled={saving} onPress={() => void complete()} style={[styles.onboardingButton, saving && styles.primaryButtonDisabled]}><Text style={styles.onboardingButtonText}>{saving ? "正在保存" : "继续"}</Text></Pressable>
    </ScrollView>
  );
}

function PlanningPreviewScreen({ preview, busy, error, onConfirm, onReject, onRecompute }: {
  preview: EvidenceBriefArtifact;
  busy: boolean;
  error?: string;
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
  return <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
    <View style={styles.screenHeader}><View><Text style={styles.screenTitle}>长期路线预览</Text><Text style={styles.screenSub}>{preview.planningPreview?.status === "awaiting_confirmation" ? "确认前不会写入 GoalCycle、PlanRevision 或 Today" : preview.planningPreview?.status === "stale" ? "上游事实已变化，需要重新计算" : "你保留了当前状态，可以随时重新计算"}</Text></View></View>
    <View style={styles.detailCard}>
      <Text style={styles.cardEyebrow}>当前策略</Text>
      <Text style={styles.detailTitle}>{strategyLabel(proposal.strategySelection?.primary ?? "unknown")}</Text>
      <Text style={styles.detailMeta}>{phase?.objective ?? "根据已确认资料生成"}</Text>
      {phase ? <Text style={styles.planFootnote}>预计 {phase.expectedDurationWeeks.min}–{phase.expectedDurationWeeks.max} 周 · 复核 {phase.reviewAt}</Text> : null}
    </View>
    <View style={styles.detailCard}>
      <Text style={styles.cardEyebrow}>三档预测</Text>
      <View style={styles.planForecastRow}>{(proposal.adaptiveForecasts ?? []).map((forecast) => <View key={forecast.scenario} style={styles.planForecastItem}>
        <Text style={styles.planForecastName}>{forecastScenarioLabel(forecast.scenario)}</Text>
        <Text style={styles.planForecastMeta}>{forecast.eligibility === "eligible" ? "可选" : forecast.eligibility === "degraded" ? "降级" : "不可用"}</Text>
        <Text style={styles.planForecastDate}>{forecast.earliest}–{forecast.latest}</Text>
        <Text style={styles.planForecastDate}>{forecast.phaseRoute.join(" → ")}</Text>
        <Text style={styles.planForecastDate}>置信度 {Math.round(forecast.confidence.min * 100)}–{Math.round(forecast.confidence.max * 100)}%</Text>
        <Text style={styles.planForecastDate}>复核 {forecast.recalibrateAt}</Text>
      </View>)}</View>
      {(proposal.adaptiveForecasts ?? []).map((forecast) => <Text key={`${forecast.scenario}:detail`} style={styles.detailMeta}>{forecastScenarioLabel(forecast.scenario)} · 执行 {forecast.executionRequirements.join("、")} · 代价 {forecast.tradeoffs.join("、")} · 护栏 {forecast.guardrails.join("、")}</Text>)}
      <Text style={styles.planFootnote}>预测包含执行要求、代价和安全边界，会在真实趋势后重新校准。</Text>
    </View>
    {proposal.explanation ? <View style={styles.detailCard}>
      <Text style={styles.cardEyebrow}>为什么这样安排</Text>
      <Text style={styles.detailMeta}>个人事实：{proposal.explanation.userEvidence.join("、")}</Text>
      <Text style={styles.detailMeta}>规则：{proposal.explanation.ruleReason.join("、")}</Text>
      {proposal.explanation.researchEvidence.map((citation) => <Text key={citation.citationId} style={styles.detailMeta}>本地依据：{citation.citationId} · {citation.claim} · 适用 {citation.population} · 局限 {citation.limitation}</Text>)}
      <Text style={styles.detailMeta}>未知：{proposal.explanation.uncertainty.join("、")}</Text>
      <Text style={styles.detailMeta}>替代：{proposal.explanation.alternative.join("、")}</Text>
    </View> : null}
    {error ? <Text style={styles.formError}>{error}</Text> : null}
    {preview.planningPreview?.status === "awaiting_confirmation" && onConfirm ? <Pressable accessibilityRole="button" disabled={busy} onPress={onConfirm} style={[styles.primaryButton, busy && styles.primaryButtonDisabled]}><Text style={styles.primaryButtonText}>{busy ? "正在处理" : "确认并生成本周计划"}</Text></Pressable> : null}
    <Pressable accessibilityRole="button" disabled={busy} onPress={onRecompute} style={styles.onboardingButton}><Text style={styles.onboardingButtonText}>重新计算预览</Text></Pressable>
    {preview.planningPreview?.status === "awaiting_confirmation" && onReject ? <Pressable accessibilityRole="button" disabled={busy} onPress={onReject} style={styles.previewRejectButton}><Text style={styles.previewRejectText}>保留当前状态</Text></Pressable> : null}
  </ScrollView>;
}

function Question<T extends string>({ label, options, selected, onSelect }: { label: string; options: readonly { id: T; label: string }[]; selected: T; onSelect: (id: T) => void }) {
  return <View style={styles.question}><Text style={styles.questionLabel}>{label}</Text><View style={styles.optionList}>{options.map((option) => <Pressable key={option.id} accessibilityRole="radio" accessibilityState={{ selected: selected === option.id }} onPress={() => onSelect(option.id)} style={[styles.option, selected === option.id && styles.optionSelected]}><Text style={[styles.optionText, selected === option.id && styles.optionTextSelected]}>{option.label}</Text></Pressable>)}</View></View>;
}

function WorkoutScreen({ application, userId, workoutId, onOpenCoach, onFinished, onUnavailable, onOpenSavedVideo }: {
  application: CoachApplication;
  userId: string;
  workoutId: string;
  onOpenCoach: () => void;
  onFinished: () => void;
  onUnavailable: () => void;
  onOpenSavedVideo: (selection: ReplaySelection) => void;
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
    return <PausedWorkoutScreen application={application} userId={userId} workoutId={workoutId} reason={workout.state.pauseReason} onFinished={onFinished} onResumed={() => void load()} />;
  }
  if (workout.state.mode === "coach_monitor") {
    return (
      <WorkoutMonitorWorkspace
        application={application}
        userId={userId}
        workoutId={workoutId}
        exerciseVariantId={nextWorkoutExerciseId(workout)}
        onExit={() => void load()}
        onOpenSavedVideo={onOpenSavedVideo}
      />
    );
  }
  const completed = new Set(workout.setOutcomes.map((outcome) => outcome.prescriptionSetId));
  const skipped = new Set((workout.skippedSets ?? []).map((set) => set.prescriptionSetId));
  const resolved = new Set([...completed, ...skipped]);
  const pending = workout.frozenPrescription.tasks.flatMap((task) => task.sets.map((set) => ({ task, set }))).find(({ set }) => !resolved.has(set.id));
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
  const confirm = async () => {
    if (!pending) return;
    try {
      const outcome = await application.confirmCurrentSet({ userId, workoutId, confirmAsPlanned: true, idempotencyKey: `mobile-workout:${workoutId}:set:${pending.set.id}` });
      const rest = pending.set.rest ?? workout.state.policy.defaultRest;
      if (rest) await startRest(pending.set.id, rest);
      await refreshNextSetRecommendation(outcome.id);
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "本组未能保存"); }
  };
  const skipCurrentSet = async (reason: string) => {
    if (!pending) return;
    try {
      await application.skipCurrentSet({
        userId,
        workoutId,
        reason,
        idempotencyKey: `mobile-workout:${workoutId}:skip:${pending.set.id}`,
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
    setActualReps(pending.set.targetReps ? String(pending.set.targetReps.max) : "");
    setActualLoad(pending.set.targetLoad ? String(pending.set.targetLoad.value) : "");
    setActualRir(pending.set.targetRir === undefined ? "" : String(pending.set.targetRir));
    setEditingActual(true);
  };
  const openTarget = () => {
    if (!pending) return;
    setTargetReps(pending.set.targetReps ? String(pending.set.targetReps.max) : "");
    setTargetLoad(pending.set.targetLoad ? String(pending.set.targetLoad.value) : "");
    setTargetRir(pending.set.targetRir === undefined ? "" : String(pending.set.targetRir));
    setEditingTarget(true);
  };
  const confirmActual = async () => {
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
    try {
      const draft = await application.saveCurrentSetDraft({
        userId,
        workoutId,
        idempotencyKey: `mobile-workout:${workoutId}:draft:${pending.set.id}`,
        draft: {
          ...(reps !== undefined ? { actualReps: reps } : {}),
          ...(actualLoadValue !== undefined && pending.set.targetLoad ? { actualLoad: { value: actualLoadValue, unit: pending.set.targetLoad.unit } } : {}),
          ...(rir !== undefined ? { actualRir: rir } : {}),
        },
      });
      const outcome = await application.confirmCurrentSet({ userId, workoutId, draftId: draft.id, idempotencyKey: `mobile-workout:${workoutId}:confirm:${pending.set.id}` });
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
      await application.editUpcomingWorkoutPrescription({
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
      });
      setEditingTarget(false);
      setNextSetRecommendation(undefined);
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "本组开始后不能再修改目标"); }
  };
  const finish = async () => {
    try {
      await application.completeWorkoutSession({ userId, workoutId, status: pending ? "partial" : "completed", idempotencyKey: `mobile-workout:${workoutId}:finish` });
      onFinished();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "训练未能结束"); }
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
  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.workoutTop}><View><Text style={styles.screenTitle}>{workout.frozenPrescription.title}</Text><Text style={styles.screenSub}>记录模式</Text></View><View style={styles.workoutTopActions}><Text style={styles.workoutProgress}>{workout.setOutcomes.length} / {workout.frozenPrescription.tasks.reduce((total, task) => total + task.sets.length, 0)}</Text>{skipped.size ? <Text style={{ color: colors.terra, fontSize: 11, fontWeight: "800" }}>已跳过 {skipped.size} 组</Text> : null}<Pressable accessibilityRole="button" accessibilityLabel="打开训练中的 Coach" onPress={onOpenCoach} style={styles.workoutCoachButton}><Text style={styles.workoutCoachButtonText}>Coach</Text></Pressable></View></View>
      <View style={styles.monitorEntry}><View><Text style={styles.monitorEntryTitle}>需要时再打开监控</Text><Text style={styles.monitorEntrySub}>相机不会替你确认重量或 RIR</Text></View><Pressable accessibilityRole="button" onPress={() => void enableMonitor()} style={styles.monitorEntryButton}><Text style={styles.monitorEntryButtonText}>开启</Text></Pressable></View>
      {restRemaining !== null ? <View style={styles.restCard}><View><Text style={styles.cardEyebrow}>组间休息</Text><Text style={styles.restTime}>{formatRestSeconds(restRemaining)}</Text></View><View style={styles.restActions}><Pressable accessibilityRole="button" accessibilityLabel="增加三十秒休息" onPress={() => void adjustRest(30)} style={styles.restAdd}><Text style={styles.restAddText}>+30 秒</Text></Pressable><Pressable accessibilityRole="button" onPress={() => void cancelRest()} style={styles.restCancel}><Text style={styles.restCancelText}>结束</Text></Pressable></View></View> : null}
      {nextSetRecommendation?.status === "proposal" ? <View style={styles.nextSetRecommendation}><View style={styles.nextSetRecommendationBody}><Text style={styles.cardEyebrow}>下一组</Text><Text style={styles.nextSetRecommendationTitle}>可以做一次小调整</Text><Text style={styles.nextSetRecommendationDetail}>{nextSetRecommendation.decision.explanation}</Text></View><Pressable accessibilityRole="button" onPress={() => void applyNextSetRecommendation()} style={styles.nextSetRecommendationButton}><Text style={styles.nextSetRecommendationButtonText}>应用</Text></Pressable></View> : null}
      {pending ? (
        <View style={styles.currentSetCard}>
          <Text style={styles.cardEyebrow}>当前组</Text>
          <Text style={styles.currentSetTitle}>{pending.task.exerciseVariantId}</Text>
          <Text style={styles.currentSetDose}>{setDose(pending.set)}</Text>
          <Text style={styles.currentSetBoundary}>重量、RIR 与疼痛只来自你的确认；相机不会替你推断。</Text>
          {editingActual ? (
            <View style={styles.actualForm}>
              <ActualInput label="次数" value={actualReps} onChange={setActualReps} />
              <ActualInput label="重量" value={actualLoad} onChange={setActualLoad} />
              <ActualInput label="RIR" value={actualRir} onChange={setActualRir} />
              <Pressable accessibilityRole="button" onPress={() => void confirmActual()} style={styles.primaryButton}><Text style={styles.primaryButtonText}>确认实际完成</Text></Pressable>
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
              <Pressable accessibilityRole="button" onPress={() => void confirm()} style={styles.primaryButton}><Text style={styles.primaryButtonText}>按计划完成本组</Text></Pressable>
              <View style={styles.setActions}>
                <Pressable accessibilityRole="button" onPress={openActual} style={styles.actualButton}><Text style={styles.actualButtonText}>记录实际完成</Text></Pressable>
                <Pressable accessibilityRole="button" onPress={openTarget} style={styles.actualButton}><Text style={styles.actualButtonText}>调整本组目标</Text></Pressable>
                <Pressable accessibilityRole="button" onPress={() => setShowSkipSet(true)} style={styles.actualButton}><Text style={styles.skipSetText}>跳过本组</Text></Pressable>
              </View>
            </>
          )}
          {!editingActual && !editingTarget ? <Pressable accessibilityRole="button" onPress={() => setManagingUpcomingTasks(true)} style={styles.manageWorkoutTasksButton}><Text style={styles.manageWorkoutTasksText}>管理后续动作</Text></Pressable> : null}
        </View>
      ) : <Empty label="本次计划中的组已处理。" />}
      <Text style={styles.sectionTitle}>训练内容</Text>
      {workout.frozenPrescription.tasks.map((task) => <View key={task.id} style={styles.workoutTask}><Text style={styles.workoutTaskTitle}>{task.exerciseVariantId}</Text>{task.sets.map((set, index) => <View key={set.id} style={styles.workoutSetRow}><Text style={styles.workoutSetIndex}>{index + 1}</Text><Text style={styles.workoutSetDose}>{setDose(set)}</Text><Text style={[styles.workoutSetState, completed.has(set.id) && styles.workoutSetDone, skipped.has(set.id) && styles.workoutSetSkipped]}>{completed.has(set.id) ? "已记录" : skipped.has(set.id) ? "已跳过" : "待完成"}</Text></View>)}</View>)}
      {error ? <Text style={styles.formError}>{error}</Text> : null}
      <Pressable accessibilityRole="button" onPress={() => void pause()} style={styles.pauseButton}><Text style={styles.pauseButtonText}>暂停训练</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={() => setShowSafetyPauseChoices(true)} style={styles.safetyPauseButton}><Text style={styles.safetyPauseButtonText}>安全暂停</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={() => void finish()} style={styles.finishButton}><Text style={styles.finishButtonText}>{pending ? "结束并标记未完成" : "完成训练"}</Text></Pressable>
      {managingUpcomingTasks ? <WorkoutTaskEditor application={application} userId={userId} workout={workout} onDismiss={() => setManagingUpcomingTasks(false)} onChanged={() => { setNextSetRecommendation(undefined); void load(); }} /> : null}
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
      <Text style={styles.skipSetDetail}>{exerciseVariantId} 会保留在今天的训练记录中，但不会算作已完成训练量。</Text>
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
  userId,
  workout,
  onDismiss,
  onChanged,
}: {
  application: CoachApplication;
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
    (task) => !task.sets.some((set) => completed.has(set.id) || drafted.has(set.id)),
  );
  const candidates = application.searchExerciseCatalog({ query, limit: 6 });
  const selectedExercise = selectedExerciseId
    ? candidates.find((candidate) => candidate.id === selectedExerciseId) ??
      application.searchExerciseCatalog({ query: selectedExerciseId, limit: 1 })[0]
    : undefined;
  const commit = async (
    change: Parameters<CoachApplication["editUpcomingWorkoutPrescription"]>[0]["change"],
    reason: string,
  ) => {
    setBusy(true);
    try {
      await application.editUpcomingWorkoutPrescription({
        userId,
        workoutId: workout.id,
        change,
        reason,
        idempotencyKey: `mobile-workout:${workout.id}:task-edit:${workout.revision}:${change.kind}:${selectedTaskId ?? selectedExerciseId ?? "none"}`,
      });
      setError(undefined);
      onChanged();
      onDismiss();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法更新尚未开始的动作");
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
    await commit({
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
          <View><Text style={styles.logTitle}>后续动作</Text><Text style={styles.exerciseManagerSub}>已完成或正在记录的组保持不变。更换动作不会沿用原动作的目标重量。</Text></View>
          <Pressable accessibilityRole="button" accessibilityLabel="关闭后续动作管理" onPress={onDismiss} style={styles.exerciseClose}><Text style={styles.exerciseCloseText}>完成</Text></Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.exerciseManagerScroll} keyboardShouldPersistTaps="handled">
          <Text style={styles.exerciseFieldLabel}>尚未开始</Text>
          {editableTasks.length ? editableTasks.map((task) => {
            const originalIndex = workout.frozenPrescription.tasks.findIndex((candidate) => candidate.id === task.id);
            return <View key={task.id} style={[styles.workoutTaskEditorRow, selectedTaskId === task.id && styles.workoutTaskEditorRowSelected]}>
              <Pressable accessibilityRole="radio" accessibilityState={{ selected: selectedTaskId === task.id }} onPress={() => setSelectedTaskId(task.id)} style={styles.workoutTaskEditorPrimary}><Text style={styles.workoutTaskTitle}>{task.exerciseVariantId}</Text><Text style={styles.exerciseManagerSub}>{task.sets.length} 组 · 可替换、排序或移除</Text></Pressable>
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
          {error ? <Text style={styles.formError}>{error}</Text> : null}
        </ScrollView>
      </View>
    </View>
  );
}

function PausedWorkoutScreen({ application, userId, workoutId, reason, onFinished, onResumed }: { application: CoachApplication; userId: string; workoutId: string; reason?: "user" | "safety" | "background" | "schedule"; onFinished: () => void; onResumed: () => void }) {
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const resume = async () => {
    setBusy(true);
    try {
      const result = await application.resumeWorkoutSession({
        userId,
        workoutId,
        acknowledgeSafetyPause: reason === "safety",
        idempotencyKey: `mobile-workout:${workoutId}:resume`,
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
      await application.completeWorkoutSession({
        userId,
        workoutId,
        status: "partial",
        idempotencyKey: `mobile-workout:${workoutId}:finish-paused`,
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

function BottomNavigation({ route, onChange }: { route: ProductRoute; onChange: (route: ProductRoute) => void }) {
  const items: readonly { route: ProductRoute; label: string; icon: string }[] = [
    { route: "today", label: "今天", icon: "⌂" },
    { route: "calendar", label: "日历", icon: "▦" },
    { route: "plan", label: "计划", icon: "↗" },
    { route: "progress", label: "进展", icon: "◔" },
    { route: "profile", label: "我的", icon: "○" },
  ];
  return <View style={styles.tabbar}>{items.map((item) => <Pressable key={item.route} accessibilityRole="tab" accessibilityState={{ selected: route === item.route }} onPress={() => onChange(item.route)} style={styles.tab}><Text style={[styles.tabIcon, route === item.route && styles.tabOn]}>{item.icon}</Text><Text style={[styles.tabLabel, route === item.route && styles.tabOn]}>{item.label}</Text></Pressable>)}</View>;
}

function Timeline({ entries, compact = false, onCorrect }: { entries: ReadonlyArray<CoachProductProjection["today"]["activityLog"]["entries"][number]>; compact?: boolean; onCorrect?: (entry: TimelineReadEvent) => void }) {
  if (!entries.length) return <Empty label="还没有真实记录。可以记录活动、饮食、睡眠或恢复状态。" compact={compact} />;
  return <View style={compact ? styles.timelineCompact : styles.timeline}>{entries.map((entry) => <View key={entry.eventId} style={styles.timelineRow}><Text style={styles.timelineTime}>{entry.occurredAt.slice(11, 16)}</Text><View style={styles.timelineDot} /><View style={styles.timelineBody}><Text style={styles.timelineTitle}>{timelineSummary(entry)}</Text><Text style={styles.timelineMeta}>{entry.envelope?.provenance.confidence === "estimated" ? "估算" : "已确认"} · {entry.envelope?.provenance.origin ?? "本地"}</Text></View>{onCorrect && canCorrectTimelineEntry(entry) ? <Pressable accessibilityRole="button" accessibilityLabel={`更正${timelineSummary(entry)}`} onPress={() => onCorrect(entry)} hitSlop={8} style={styles.timelineCorrect}><Text style={styles.timelineCorrectText}>更正</Text></Pressable> : null}</View>)}</View>;
}

function PlanSession({ session, subdued = false }: { session: ProductSession; subdued?: boolean }) {
  return <View style={[styles.planSession, subdued && styles.planSessionSubdued]}><Text style={styles.planSessionDate}>{shortDate(session.scheduledFor)}</Text><View style={styles.planSessionBody}><Text style={styles.planSessionTitle}>{session.title}</Text><Text style={styles.planSessionMeta}>{sessionMeta(session)}</Text></View><Text style={styles.chevron}>›</Text></View>;
}

function Metric({ value, label }: { value: string; label: string }) { return <View style={styles.metric}><Text style={styles.metricValue}>{value || "—"}</Text><Text style={styles.metricLabel}>{label}</Text></View>; }
function ProgressMetric({ label, value, meta }: { label: string; value: string; meta: string }) { return <View style={styles.progressMetric}><Text style={styles.progressMetricValue}>{value}</Text><Text style={styles.progressMetricLabel}>{label}</Text><Text style={styles.progressMetricMeta}>{meta}</Text></View>; }
function ProfileRow({ label, value }: { label: string; value: string }) { return <View style={styles.profileRow}><Text style={styles.profileLabel}>{label}</Text><Text style={styles.profileValue}>{value}</Text></View>; }
function CoachPending({ prompt }: { prompt: string }) { return <View style={styles.pendingCard}><Text style={styles.pendingLabel}>等待确认</Text><Text style={styles.pendingText}>{prompt}</Text></View>; }
function Empty({ label, compact = false }: { label: string; compact?: boolean }) { return <View style={[styles.empty, compact && styles.emptyCompact]}><Text style={styles.emptyText}>{label}</Text></View>; }
function LoadingState() { return <View style={styles.statePage}><ActivityIndicator color={colors.limeDeep} /><Text style={styles.stateText}>正在读取本地资料</Text></View>; }
function ErrorState({ message, onRetry, title = "暂时无法打开资料", retryLabel = "重试" }: { message: string; onRetry: () => void; title?: string; retryLabel?: string }) { return <View style={styles.statePage}><Text style={styles.stateTitle}>{title}</Text><Text style={styles.stateText}>{message}</Text><Pressable accessibilityRole="button" onPress={onRetry} style={styles.retry}><Text style={styles.retryText}>{retryLabel}</Text></Pressable></View>; }

function routeContext(route: ProductRoute): CoachContextKind {
  if (route === "plan") return "plan";
  if (route === "profile" || route === "onboarding") return "profile";
  if (route === "video_library" || route === "replay") return "progress";
  return route;
}

function localDate(): string { return new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10); }
/** Compatibility helper retained for adapters that only emit the old trio. */
export function resolveNotificationDeepLink(value?: string): { route: "today" | "progress" | "workout"; ref: string } | undefined {
  const intent = resolveMaxPowerDeepLink(value);
  if (!intent || intent.route === "calendar" || intent.route === "plan" || intent.route === "profile") return undefined;
  return intent.route === "workout"
    ? { route: "workout", ref: intent.workoutId }
    : { route: intent.route, ref: intent.date };
}
function isProductDeepLinkRoute(route: ProductRoute): route is ProductDeepLinkRoute {
  return route === "today" || route === "calendar" || route === "plan" || route === "progress" || route === "profile" || route === "workout";
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
function sessionMeta(session: ProductSession): string { return `${session.kind === "cardio" ? "有氧" : session.kind === "rest" || session.kind === "recovery" ? "恢复" : "训练"}${session.estimatedMinutes ? ` · ${session.estimatedMinutes} 分钟` : ""}${session.taskCount ? ` · ${session.taskCount} 项` : ""}`; }
function outcomeStatusLabel(status: WorkoutOutcomeProductSummary["status"]): string { return status === "completed" ? "已完成" : status === "partial" ? "部分完成" : "已中止"; }
function outcomeCompletenessLabel(value: WorkoutOutcomeProductSummary["dataCompleteness"]): string { return value === "complete" ? "记录完整" : value === "partial" ? "部分记录" : "手动记录"; }
function trendValue(value: number | undefined, unit: string | undefined): string { return value === undefined ? "—" : `${value.toFixed(1)}${unit === "percent" ? "%" : unit ?? ""}`; }
function trendCoverage(count: number | undefined): string { return count ? `${count} 条可比记录` : "记录不足"; }
function goalLabel(value?: string): string { return value === "hypertrophy" ? "增肌" : value === "strength" ? "增力" : value === "fat_loss_preserve_lean_mass" ? "减脂保肌" : "待填写"; }
function movementLabel(value?: MovementPattern): string { return movementChoices.find((choice) => choice.value === value)?.label ?? "未分类"; }
function mandateLabel(value?: string): string { return value === "manual" ? "手动" : value === "managed" ? "托管" : value === "collaborative" ? "协作" : "待选择"; }
function permissionLabel(value: string): string { return value === "granted" ? "已允许" : value === "denied" ? "未允许" : "未设置"; }
function privacyAccountLabel(overview: PrivacySettingsOverviewValue): string {
  if (overview.account.state === "authenticated") return overview.account.provider ? `已连接 ${overview.account.provider}` : "已连接";
  if (overview.account.state === "guest") return "访客";
  if (overview.account.availability === "temporarily_unavailable") return "暂时不可用";
  return "本机资料";
}
function privacyAccountDetail(overview: PrivacySettingsOverviewValue): string {
  if (overview.account.state === "authenticated") return "账号连接不会替换或移动这台设备上的训练、计划和 Timeline。";
  if (overview.account.state === "guest") return "当前以访客模式使用；建档、训练、记录和本地提醒都可以离线完成。";
  if (overview.account.availability === "temporarily_unavailable") return "账号服务暂时不可用；本机训练记录仍可继续使用。";
  return "当前资料保留在本机；账号连接在可用版本中始终是可选的。";
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
  if (overview.remoteModel.configuration.status === "credential_unavailable") return "凭据不可用";
  if (overview.remoteModel.configuration.status === "not_configured") return overview.remoteModel.authorization === "granted" ? "待配置" : overview.remoteModel.authorization === "denied" ? "已关闭" : "未启用";
  if (overview.remoteModel.consent.status === "active") return "已允许";
  if (overview.remoteModel.consent.status === "review_required") return "需要确认";
  return overview.remoteModel.authorization === "denied" ? "已关闭" : "未启用";
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
function formatRestSeconds(seconds: number): string { return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`; }
function nextWorkoutExerciseId(workout: { frozenPrescription: { tasks: readonly { exerciseVariantId: string; sets: readonly { id: string }[] }[] }; setOutcomes: readonly { prescriptionSetId: string }[]; skippedSets?: readonly { prescriptionSetId: string }[] }): string | undefined {
  const resolved = new Set([
    ...workout.setOutcomes.map((outcome) => outcome.prescriptionSetId),
    ...(workout.skippedSets ?? []).map((set) => set.prescriptionSetId),
  ]);
  return workout.frozenPrescription.tasks.find((task) => task.sets.some((set) => !resolved.has(set.id)))?.exerciseVariantId;
}
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
  page: { flex: 1, backgroundColor: colors.paper },
  content: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 116, gap: 14 },
  statePage: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, backgroundColor: colors.paper, padding: 24 },
  stateTitle: { fontSize: 19, fontWeight: "800", color: colors.ink }, stateText: { color: colors.ink2, textAlign: "center", lineHeight: 20 }, retry: { backgroundColor: colors.dark, borderRadius: radius.chip, paddingHorizontal: 22, paddingVertical: 11 }, retryText: { color: colors.white, fontWeight: "800" },
  noticeSpacer: { height: 4 }, coachNotice: { height: 48, borderRadius: 15, backgroundColor: colors.white, flexDirection: "row", alignItems: "center", paddingHorizontal: 14, gap: 10 }, noticeDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.limeDeep }, coachNoticeText: { flex: 1, fontWeight: "700", color: colors.ink }, noticeChevron: { color: colors.ink3, fontSize: 22 },
  todayHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 6 }, date: { fontSize: 17, fontWeight: "800", color: colors.ink }, calendarLink: { color: colors.ink2, fontWeight: "700" },
  todayCard: { height: 456, borderRadius: 30, backgroundColor: colors.dark, overflow: "hidden" }, summaryArea: { height: 196, padding: 24, paddingBottom: 16 }, cardEyebrow: { color: colors.lime, fontSize: 12, fontWeight: "800", letterSpacing: 1.1 }, planTitle: { color: colors.white, fontSize: 35, lineHeight: 40, fontWeight: "900", marginTop: 10 }, planSubtitle: { color: "#B7BBB3", fontSize: 14, marginTop: 8 }, metricsRow: { flexDirection: "row", gap: 12, marginTop: 18 }, metric: { flex: 1, borderTopColor: "rgba(255,255,255,0.18)", borderTopWidth: 1, paddingTop: 8 }, metricValue: { color: colors.white, fontSize: 19, fontWeight: "800" }, metricLabel: { color: "#999E96", fontSize: 10, marginTop: 3 },
  taskArea: { height: 176, backgroundColor: "rgba(255,255,255,0.05)", borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.10)" }, taskScroll: { paddingVertical: 2 }, taskRow: { paddingHorizontal: 24, paddingVertical: 10, minHeight: 48 }, taskName: { color: colors.white, fontSize: 14, fontWeight: "700", paddingRight: 100 }, taskSummary: { position: "absolute", right: 24, top: 10, color: "#B6BAAF", fontFamily: "monospace", fontSize: 11 }, rowDivider: { position: "absolute", bottom: 0, left: 24, right: 24, height: StyleSheet.hairlineWidth, backgroundColor: "rgba(255,255,255,0.12)" }, planEmpty: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 30 }, planEmptyText: { color: "#B7BBB3", textAlign: "center", lineHeight: 20 }, cardFooter: { height: 84, paddingHorizontal: 24, justifyContent: "center" }, primaryButton: { backgroundColor: colors.lime, minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: radius.chip }, primaryButtonText: { color: colors.limeInk, fontSize: 17, fontWeight: "900" },
  primaryButtonDisabled: { opacity: 0.42 },
  activityLogButton: { minHeight: 44, borderRadius: radius.chip, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white, alignItems: "center", justifyContent: "center" }, activityLogButtonText: { color: colors.ink, fontSize: 14, fontWeight: "800" },
  startChoiceScrim: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: 40, justifyContent: "flex-end", backgroundColor: "rgba(10,12,10,0.42)" }, startChoiceSheet: { backgroundColor: colors.paper, borderTopLeftRadius: 30, borderTopRightRadius: 30, paddingHorizontal: 22, paddingTop: 12, paddingBottom: 38, gap: 12 }, sheetHandle: { width: 38, height: 4, borderRadius: 4, backgroundColor: colors.line, alignSelf: "center", marginBottom: 4 }, startChoiceTitle: { color: colors.ink, fontSize: 25, lineHeight: 30, fontWeight: "900" }, startChoiceSub: { color: colors.ink2, fontSize: 13, lineHeight: 19, marginBottom: 3 }, startChoicePrimary: { backgroundColor: colors.dark, borderRadius: radius.card, minHeight: 78, justifyContent: "center", paddingHorizontal: 17 }, startChoicePrimaryTitle: { color: colors.white, fontSize: 16, fontWeight: "900" }, startChoicePrimarySub: { color: "#B7BBB3", fontSize: 12, marginTop: 4 }, startChoiceSecondary: { backgroundColor: colors.white, borderRadius: radius.card, minHeight: 78, justifyContent: "center", paddingHorizontal: 17, borderWidth: 1, borderColor: colors.line }, startChoiceSecondaryTitle: { color: colors.ink, fontSize: 16, fontWeight: "900" }, startChoiceSecondarySub: { color: colors.ink3, fontSize: 12, marginTop: 4 },
  logScrim: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: 42, justifyContent: "flex-end", backgroundColor: "rgba(10,12,10,0.42)" }, logSheet: { backgroundColor: colors.paper, borderTopLeftRadius: 30, borderTopRightRadius: 30, paddingHorizontal: 22, paddingTop: 12, paddingBottom: 38, gap: 12 }, logTitle: { color: colors.ink, fontSize: 24, fontWeight: "900" }, logModeRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, logMode: { flexGrow: 1, minWidth: 56, minHeight: 38, borderRadius: radius.chip, alignItems: "center", justifyContent: "center", backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line }, logModeSelected: { backgroundColor: colors.dark, borderColor: colors.dark }, logModeText: { color: colors.ink2, fontSize: 13, fontWeight: "800" }, logModeTextSelected: { color: colors.lime }, logQuickRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, logQuick: { minHeight: 36, borderRadius: radius.chip, paddingHorizontal: 13, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, justifyContent: "center" }, logQuickSelected: { backgroundColor: "#EEF9C7", borderColor: colors.limeDeep }, logQuickText: { color: colors.ink2, fontSize: 12, fontWeight: "700" }, logQuickTextSelected: { color: colors.limeInk }, logInput: { minHeight: 46, borderRadius: 12, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white, color: colors.ink, paddingHorizontal: 13, fontSize: 14 }, logDuration: { minHeight: 46, borderRadius: 12, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white, paddingHorizontal: 13, flexDirection: "row", alignItems: "center" }, logLabel: { flex: 1, color: colors.ink2, fontSize: 13 }, logDurationInput: { width: 70, color: colors.ink, fontFamily: "monospace", textAlign: "right", fontWeight: "800", fontSize: 15 }, nutritionChoice: { gap: 7 }, nutritionMetricGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, nutritionMetric: { width: "48%", minHeight: 68, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 12, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white, gap: 5 }, nutritionMetricLabel: { color: colors.ink2, fontSize: 12, fontWeight: "700" }, nutritionMetricInput: { color: colors.ink, fontFamily: "monospace", fontWeight: "800", fontSize: 16, padding: 0 }, logSave: { minHeight: 48, borderRadius: radius.chip, backgroundColor: colors.dark, alignItems: "center", justifyContent: "center", marginTop: 2 }, logSaveText: { color: colors.lime, fontSize: 16, fontWeight: "900" },
  outcomeSheet: { backgroundColor: colors.paper, borderTopLeftRadius: 30, borderTopRightRadius: 30, paddingHorizontal: 22, paddingTop: 12, paddingBottom: 38, gap: 12 }, outcomeTitle: { color: colors.ink, fontSize: 26, lineHeight: 32, fontWeight: "900" }, outcomeStatus: { color: colors.limeInk, fontSize: 14, fontWeight: "800" }, outcomeMetricRow: { flexDirection: "row", gap: 8 }, outcomeMetric: { flex: 1, minHeight: 80, borderRadius: radius.row, backgroundColor: colors.white, padding: 12, justifyContent: "space-between" }, outcomeMetricValue: { color: colors.ink, fontSize: 17, fontWeight: "900" }, outcomeMetricLabel: { color: colors.ink3, fontSize: 10, lineHeight: 14 }, outcomeFacts: { backgroundColor: colors.white, borderRadius: radius.row, paddingHorizontal: 14 }, outcomeFactRow: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomColor: colors.line, borderBottomWidth: StyleSheet.hairlineWidth }, outcomeFactLabel: { color: colors.ink2, fontSize: 12 }, outcomeFactValue: { color: colors.ink, fontSize: 12, fontWeight: "800" }, outcomeBoundary: { color: colors.ink3, fontSize: 11, lineHeight: 17 }, outcomeCorrectionButton: { minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.chip, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line }, outcomeCorrectionButtonText: { color: colors.ink, fontSize: 14, fontWeight: "800" },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 12 }, sectionTitle: { fontSize: 17, color: colors.ink, fontWeight: "900", marginTop: 4 }, sectionMeta: { color: colors.ink3, fontSize: 12 }, sectionLink: { color: colors.limeInk, fontSize: 12, fontWeight: "800" }, timeline: { backgroundColor: colors.white, borderRadius: radius.card, paddingVertical: 5 }, timelineCompact: { marginTop: 12 }, timelineRow: { flexDirection: "row", paddingVertical: 11, paddingHorizontal: 14, alignItems: "flex-start" }, timelineTime: { color: colors.ink3, fontFamily: "monospace", fontSize: 11, width: 38, paddingTop: 2 }, timelineDot: { width: 8, height: 8, marginTop: 5, marginRight: 12, backgroundColor: colors.limeDeep, borderRadius: 4 }, timelineBody: { flex: 1 }, timelineTitle: { color: colors.ink, fontSize: 14, fontWeight: "700" }, timelineMeta: { color: colors.ink3, fontSize: 11, marginTop: 3 }, timelineCorrect: { minHeight: 30, justifyContent: "center", paddingHorizontal: 8, marginLeft: 8 }, timelineCorrectText: { color: colors.limeInk, fontSize: 12, fontWeight: "800" }, empty: { backgroundColor: colors.white, borderRadius: radius.card, paddingHorizontal: 20, paddingVertical: 24, marginTop: 4 }, emptyCompact: { paddingVertical: 16 }, emptyText: { color: colors.ink2, lineHeight: 20, fontSize: 13 }, pendingCard: { backgroundColor: colors.terraSoft, borderRadius: radius.card, padding: 16, gap: 5 }, pendingLabel: { color: colors.terra, fontWeight: "800", fontSize: 12 }, pendingText: { color: colors.ink, lineHeight: 20 },
  screenHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }, screenTitle: { color: colors.ink, fontSize: 28, fontWeight: "900" }, screenSub: { color: colors.ink3, marginTop: 4, fontSize: 12 }, calendarHeaderActions: { flexDirection: "row", alignItems: "center", gap: 6 }, calendarStep: { width: 34, height: 34, borderRadius: 17, borderColor: colors.line, borderWidth: 1, alignItems: "center", justifyContent: "center" }, calendarStepText: { color: colors.ink, fontSize: 23, lineHeight: 25 }, modeButton: { borderColor: colors.line, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.chip }, modeButtonText: { color: colors.ink, fontWeight: "800", fontSize: 12 },
  calendarGrid: { flexDirection: "row", flexWrap: "wrap", backgroundColor: colors.white, borderRadius: radius.card, padding: 10 }, calendarGridWeek: { flexWrap: "nowrap" }, calendarCell: { width: "14.285%", minHeight: 54, alignItems: "center", justifyContent: "center", borderRadius: 12 }, calendarCellSelected: { backgroundColor: colors.dark }, calendarDay: { color: colors.ink, fontWeight: "700", fontSize: 13 }, calendarDaySelected: { color: colors.white }, calendarMarks: { flexDirection: "row", gap: 3, height: 7, marginTop: 5 }, markPlanned: { width: 5, height: 5, borderRadius: 3, borderWidth: 1, borderColor: colors.ink2 }, markCompleted: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.limeDeep }, markPartial: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.terra }, markLog: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.ink3 }, detailCard: { backgroundColor: colors.white, borderRadius: radius.card, padding: 18 }, detailTitle: { color: colors.ink, fontSize: 20, fontWeight: "900", marginTop: 5 }, detailMeta: { color: colors.ink2, fontSize: 12, marginTop: 4 }, planForecastRow: { flexDirection: "row", gap: 7, marginTop: 14 }, planForecastItem: { flex: 1, backgroundColor: colors.paper, borderRadius: 10, padding: 9, gap: 3 }, planForecastName: { color: colors.ink, fontSize: 11, fontWeight: "900" }, planForecastMeta: { color: colors.limeInk, fontSize: 11, fontWeight: "800" }, planForecastDate: { color: colors.ink3, fontSize: 9 }, performedWorkoutRow: { minHeight: 58, marginTop: 14, paddingHorizontal: 12, borderRadius: 12, backgroundColor: "#EEF9C7", flexDirection: "row", alignItems: "center", gap: 10 }, performedWorkoutCopy: { flex: 1 }, performedWorkoutTitle: { color: colors.ink, fontSize: 13, fontWeight: "900" }, performedWorkoutMeta: { color: colors.limeInk, fontSize: 11, lineHeight: 16, marginTop: 3 },
  planSession: { backgroundColor: colors.white, borderRadius: radius.row, padding: 14, flexDirection: "row", alignItems: "center", gap: 12 }, planSessionSubdued: { opacity: 0.68 }, planSessionDate: { width: 42, color: colors.ink2, fontSize: 11, lineHeight: 15 }, planSessionBody: { flex: 1 }, planSessionTitle: { color: colors.ink, fontSize: 15, fontWeight: "800" }, planSessionMeta: { color: colors.ink3, fontSize: 11, marginTop: 4 }, chevron: { color: colors.ink3, fontSize: 22 }, planFootnote: { color: colors.ink3, fontSize: 12, lineHeight: 18, marginTop: 4 },
  exerciseManagerScrim: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: 44, justifyContent: "flex-end", backgroundColor: "rgba(10,12,10,0.42)" }, exerciseManagerSheet: { maxHeight: "82%", backgroundColor: colors.paper, borderTopLeftRadius: 30, borderTopRightRadius: 30, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 28 }, exerciseManagerHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 14 }, exerciseManagerSub: { color: colors.ink3, fontSize: 12, lineHeight: 18, marginTop: 5, maxWidth: 270 }, exerciseClose: { borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white, minHeight: 34, paddingHorizontal: 12, borderRadius: radius.chip, justifyContent: "center" }, exerciseCloseText: { color: colors.ink, fontSize: 12, fontWeight: "800" }, exerciseManagerScroll: { gap: 10, paddingBottom: 8 }, exerciseRow: { backgroundColor: colors.white, borderRadius: radius.row, minHeight: 64, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 8 }, exerciseRowBody: { flex: 1 }, exerciseRowTitle: { color: colors.ink, fontSize: 14, fontWeight: "800" }, exerciseRowMeta: { color: colors.ink3, fontSize: 11, marginTop: 4 }, exerciseInlineButton: { minHeight: 32, justifyContent: "center", paddingHorizontal: 5 }, exerciseInlineText: { color: colors.ink2, fontSize: 12, fontWeight: "800" }, exerciseArchiveText: { color: colors.terra, fontSize: 12, fontWeight: "800" }, exerciseEmpty: { color: colors.ink2, backgroundColor: colors.white, borderRadius: radius.row, padding: 15, fontSize: 13, lineHeight: 20 }, exerciseForm: { marginTop: 8, padding: 14, borderRadius: radius.card, backgroundColor: "#EEF9C7", gap: 10 }, exerciseFormTitle: { color: colors.ink, fontSize: 16, fontWeight: "900" }, exerciseFieldLabel: { color: colors.ink2, fontSize: 12, fontWeight: "800", marginTop: 2 }, exerciseFormActions: { flexDirection: "row", gap: 9 }, exerciseCancel: { minHeight: 48, minWidth: 78, borderRadius: radius.chip, justifyContent: "center", alignItems: "center", backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line }, exerciseCancelText: { color: colors.ink2, fontSize: 14, fontWeight: "800" }, exerciseSave: { flex: 1, marginTop: 0 },
  progressGrid: { flexDirection: "row", gap: 8 }, progressMetric: { flex: 1, backgroundColor: colors.white, borderRadius: radius.row, padding: 13, minHeight: 112 }, progressMetricValue: { color: colors.ink, fontSize: 20, fontWeight: "900" }, progressMetricLabel: { color: colors.ink2, fontSize: 11, marginTop: 8 }, progressMetricMeta: { color: colors.ink3, fontSize: 10, marginTop: 4, lineHeight: 14 }, reportRow: { backgroundColor: colors.white, borderRadius: radius.row, padding: 15, flexDirection: "row", justifyContent: "space-between" }, reportTitle: { color: colors.ink, fontWeight: "800" }, reportMeta: { color: colors.ink3, fontSize: 11 },
  videoLibraryCard: { backgroundColor: colors.dark, borderRadius: radius.row, padding: 16, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, videoLibraryTitle: { color: colors.white, fontSize: 15, fontWeight: "900" }, videoLibraryMeta: { color: "#aeb3a6", fontSize: 11, marginTop: 5 }, videoLibraryArrow: { color: colors.lime, fontSize: 28, lineHeight: 30 },
  profileCard: { backgroundColor: colors.white, borderRadius: radius.card, paddingHorizontal: 16 }, profileStart: { backgroundColor: colors.dark, borderRadius: radius.chip, minHeight: 48, alignItems: "center", justifyContent: "center" }, profileStartText: { color: colors.white, fontSize: 15, fontWeight: "800" }, profileRow: { minHeight: 50, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomColor: colors.line, borderBottomWidth: StyleSheet.hairlineWidth }, profileLabel: { color: colors.ink2, fontSize: 14 }, profileValue: { color: colors.ink, fontSize: 14, fontWeight: "700" }, privacySummaryLoading: { minHeight: 74, alignItems: "center", justifyContent: "center" }, privacySummaryFooter: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }, privacySummaryFooterText: { color: colors.ink3, fontSize: 12, flex: 1 }, privacySheet: { maxHeight: "84%", backgroundColor: colors.paper, borderTopLeftRadius: 30, borderTopRightRadius: 30, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 28 }, privacySheetLoading: { minHeight: 160, alignItems: "center", justifyContent: "center" }, privacyDetailList: { gap: 10, paddingBottom: 8 }, privacyDetailBlock: { backgroundColor: colors.white, borderRadius: radius.row, padding: 14, gap: 7 }, privacyDetailHeading: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 12 }, privacyDetailTitle: { color: colors.ink, fontSize: 14, fontWeight: "900" }, privacyDetailSummary: { color: colors.limeInk, fontSize: 12, fontWeight: "800", textAlign: "right" }, privacyDetailText: { color: colors.ink2, fontSize: 12, lineHeight: 18 }, privacyDetailMeta: { color: colors.ink3, fontSize: 11, lineHeight: 17, marginTop: 1 }, privacyManageButton: { minHeight: 46, borderRadius: radius.chip, backgroundColor: colors.dark, alignItems: "center", justifyContent: "center", marginTop: 2 }, privacyManageButtonText: { color: colors.lime, fontSize: 14, fontWeight: "900" }, replicaConflict: { borderLeftWidth: 2, borderLeftColor: colors.limeDeep, backgroundColor: colors.paper, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, gap: 2, marginTop: 1 }, replicaConflictTitle: { color: colors.ink, fontSize: 12, fontWeight: "800" }, replicaSyncButton: { minHeight: 42, borderRadius: radius.chip, backgroundColor: colors.dark, alignItems: "center", justifyContent: "center", marginTop: 3 }, replicaSyncButtonText: { color: colors.lime, fontSize: 13, fontWeight: "900" }, healthConnectionCard: { paddingVertical: 16, gap: 10 }, healthConnectionTop: { flexDirection: "row", alignItems: "center", gap: 12 }, healthConnectionTitle: { color: colors.ink, fontSize: 15, fontWeight: "900" }, healthConnectionMeta: { color: colors.ink3, fontSize: 12, lineHeight: 18, marginTop: 3 }, healthConnectionNote: { color: colors.ink2, fontSize: 12, lineHeight: 18 }, healthImportedList: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line, marginTop: 2 }, healthConnectionActions: { flexDirection: "row", gap: 8, marginTop: 2 }, healthConnectionPrimary: { flex: 1, minHeight: 40, borderRadius: radius.chip, backgroundColor: colors.dark, alignItems: "center", justifyContent: "center", paddingHorizontal: 12 }, healthConnectionPrimaryText: { color: colors.lime, fontSize: 12, fontWeight: "900" }, healthConnectionSecondary: { minHeight: 40, borderRadius: radius.chip, backgroundColor: colors.paper, borderColor: colors.line, borderWidth: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 14 }, healthConnectionSecondaryText: { color: colors.ink, fontSize: 12, fontWeight: "800" }, actionLogRow: { flexDirection: "row", alignItems: "center", minHeight: 56, borderBottomColor: colors.line, borderBottomWidth: StyleSheet.hairlineWidth, gap: 10 }, actionLogBody: { flex: 1 }, actionLogTitle: { color: colors.ink, fontSize: 13, fontWeight: "800" }, actionLogMeta: { color: colors.ink3, fontSize: 11, marginTop: 4 },
  permissionScrim: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: 44, justifyContent: "flex-end", backgroundColor: "rgba(10,12,10,0.42)" }, permissionSheet: { maxHeight: "82%", backgroundColor: colors.paper, borderTopLeftRadius: 30, borderTopRightRadius: 30, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 28 }, permissionList: { gap: 9, paddingBottom: 8 }, permissionRow: { backgroundColor: colors.white, borderRadius: radius.row, paddingHorizontal: 14, paddingVertical: 13, flexDirection: "row", alignItems: "center", gap: 12 }, permissionBody: { flex: 1 }, permissionTitle: { color: colors.ink, fontSize: 14, fontWeight: "800" }, permissionDescription: { color: colors.ink3, fontSize: 11, lineHeight: 16, marginTop: 4 }, permissionSwitch: { width: 45, height: 28, borderRadius: 16, backgroundColor: colors.paper2, padding: 3, justifyContent: "center" }, permissionSwitchOn: { backgroundColor: colors.limeDeep, alignItems: "flex-end" }, permissionKnob: { width: 22, height: 22, borderRadius: 12, backgroundColor: colors.white, shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 2, shadowOffset: { width: 0, height: 1 } }, permissionKnobOn: { backgroundColor: colors.dark }, actionLogScrim: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: 44, justifyContent: "flex-end", backgroundColor: "rgba(10,12,10,0.42)" }, actionLogSheet: { maxHeight: "82%", backgroundColor: colors.paper, borderTopLeftRadius: 30, borderTopRightRadius: 30, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 28 }, actionLogList: { gap: 9, paddingBottom: 8 }, actionLogDetailRow: { backgroundColor: colors.white, borderRadius: radius.row, padding: 14, gap: 4 }, actionLogDetailTop: { flexDirection: "row", justifyContent: "space-between", gap: 12 }, actionLogResult: { color: colors.limeInk, fontSize: 11, fontWeight: "800" }, actionLogDetailMeta: { color: colors.ink3, fontSize: 11, lineHeight: 16 }, actionLogIntent: { color: colors.ink2, fontSize: 12, lineHeight: 18, marginVertical: 2 }, actionLogReversible: { color: colors.limeInk, fontSize: 11, fontWeight: "800", marginTop: 2 },
  question: { gap: 9 }, questionLabel: { color: colors.ink, fontWeight: "800", fontSize: 15 }, optionList: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, option: { backgroundColor: colors.white, borderRadius: radius.chip, borderWidth: 1, borderColor: "transparent", minHeight: 40, paddingHorizontal: 13, justifyContent: "center" }, optionSelected: { backgroundColor: "#EEF9C7", borderColor: colors.limeDeep }, optionText: { color: colors.ink2, fontSize: 13, fontWeight: "700" }, optionTextSelected: { color: colors.limeInk }, onboardingFields: { flexDirection: "row", gap: 8 }, onboardingInput: { flex: 1, minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white, color: colors.ink, paddingHorizontal: 10, fontSize: 13 }, professionalToggle: { minHeight: 40, justifyContent: "center" }, professionalToggleText: { color: colors.limeInk, fontSize: 13, fontWeight: "900" }, professionalFields: { backgroundColor: colors.paper2, borderRadius: radius.card, padding: 14, gap: 12 }, confirmRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, backgroundColor: colors.white, borderRadius: radius.row, padding: 14 }, checkbox: { width: 20, height: 20, borderRadius: 6, borderWidth: 1.5, borderColor: colors.ink3, alignItems: "center", justifyContent: "center", marginTop: 1 }, checkboxOn: { borderColor: colors.limeDeep, backgroundColor: colors.lime }, checkboxMark: { color: colors.limeInk, fontWeight: "900" }, confirmText: { flex: 1, color: colors.ink2, fontSize: 13, lineHeight: 19 }, formError: { color: colors.terra, fontSize: 12 }, onboardingButton: { backgroundColor: colors.dark, minHeight: 50, borderRadius: radius.chip, alignItems: "center", justifyContent: "center", marginTop: 4 }, onboardingButtonText: { color: colors.white, fontSize: 16, fontWeight: "900" }, previewRejectButton: { minHeight: 44, alignItems: "center", justifyContent: "center", marginBottom: 24 }, previewRejectText: { color: colors.ink3, fontSize: 13, fontWeight: "800" },
  workoutTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }, workoutTopActions: { alignItems: "flex-end", gap: 8 }, workoutProgress: { color: colors.limeInk, backgroundColor: colors.lime, borderRadius: radius.chip, paddingHorizontal: 11, paddingVertical: 7, fontWeight: "900" }, workoutCoachButton: { minHeight: 34, minWidth: 72, borderRadius: radius.chip, backgroundColor: colors.dark, alignItems: "center", justifyContent: "center", paddingHorizontal: 12 }, workoutCoachButtonText: { color: colors.lime, fontSize: 12, fontWeight: "900" }, currentSetCard: { backgroundColor: colors.dark, borderRadius: 26, padding: 22, gap: 10 }, currentSetTitle: { color: colors.white, fontSize: 22, fontWeight: "900" }, currentSetDose: { color: "#C5C9C0", fontSize: 15 }, currentSetBoundary: { color: "#979C93", fontSize: 11, lineHeight: 17, marginBottom: 4 }, setActions: { flexDirection: "row", justifyContent: "space-between", gap: 12 }, actualButton: { flex: 1, alignItems: "center", minHeight: 34, justifyContent: "center" }, actualButtonText: { color: colors.lime, fontWeight: "800", fontSize: 13 }, skipSetText: { color: "#F5B6A4", fontWeight: "800", fontSize: 13 }, actualForm: { gap: 8 }, actualField: { minHeight: 42, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.10)", flexDirection: "row", alignItems: "center", paddingHorizontal: 12 }, actualLabel: { color: "#B6BAAF", width: 52, fontSize: 12 }, actualInput: { flex: 1, color: colors.white, fontSize: 15, fontWeight: "700", paddingVertical: 0, textAlign: "right" }, workoutTask: { backgroundColor: colors.white, borderRadius: radius.card, padding: 16, gap: 4 }, workoutTaskTitle: { color: colors.ink, fontWeight: "800", fontSize: 15, marginBottom: 4 }, workoutSetRow: { flexDirection: "row", alignItems: "center", minHeight: 38, gap: 10 }, workoutSetIndex: { width: 20, height: 20, borderRadius: 10, backgroundColor: colors.paper2, color: colors.ink2, fontSize: 11, textAlign: "center", paddingTop: 3 }, workoutSetDose: { flex: 1, color: colors.ink2, fontFamily: "monospace", fontSize: 12 }, workoutSetState: { color: colors.ink3, fontSize: 11 }, workoutSetDone: { color: colors.limeDeep, fontWeight: "800" }, workoutSetSkipped: { color: colors.terra, fontWeight: "800" }, manageWorkoutTasksButton: { minHeight: 38, borderRadius: radius.chip, borderWidth: 1, borderColor: "#3B4039", alignItems: "center", justifyContent: "center", marginTop: 2 }, manageWorkoutTasksText: { color: colors.white, fontSize: 13, fontWeight: "800" }, workoutTaskEditorRow: { backgroundColor: colors.white, borderRadius: radius.row, padding: 12, gap: 8 }, workoutTaskEditorRowSelected: { borderWidth: 1, borderColor: colors.limeDeep }, workoutTaskEditorPrimary: { minHeight: 38 }, workoutTaskEditorActions: { flexDirection: "row", flexWrap: "wrap", gap: 10 }, workoutTaskTiny: { minHeight: 28, justifyContent: "center" }, workoutTaskTinyText: { color: colors.ink2, fontSize: 12, fontWeight: "800" }, workoutTaskPicker: { backgroundColor: "#EEF9C7", borderRadius: radius.card, padding: 14, gap: 9, marginTop: 4 }, workoutCatalogList: { gap: 6 }, workoutCatalogRow: { backgroundColor: colors.white, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 }, workoutCatalogRowSelected: { borderWidth: 1, borderColor: colors.limeDeep }, workoutTaskBoundary: { color: colors.ink2, fontSize: 11, lineHeight: 16 }, workoutTaskAddFields: { flexDirection: "row", gap: 8 }, workoutTaskNumberField: { flex: 1, minHeight: 46, borderRadius: 12, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white, flexDirection: "row", alignItems: "center", paddingHorizontal: 10 }, workoutTaskNumberLabel: { color: colors.ink2, fontSize: 12 }, workoutTaskNumberInput: { flex: 1, color: colors.ink, fontFamily: "monospace", fontWeight: "800", textAlign: "right", fontSize: 14, paddingVertical: 0 }, workoutTaskButtons: { flexDirection: "row", gap: 8 }, workoutTaskSecondary: { flex: 1, minHeight: 46, borderRadius: radius.chip, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center", backgroundColor: colors.white }, workoutTaskSecondaryText: { color: colors.ink, fontSize: 12, fontWeight: "800" }, workoutTaskAddButton: { flex: 1, marginTop: 0 }, pauseButton: { minHeight: 42, borderRadius: radius.chip, alignItems: "center", justifyContent: "center" }, pauseButtonText: { color: colors.ink3, fontSize: 13, fontWeight: "800" }, safetyPauseButton: { minHeight: 42, borderRadius: radius.chip, alignItems: "center", justifyContent: "center", backgroundColor: colors.terraSoft }, safetyPauseButtonText: { color: colors.terra, fontSize: 13, fontWeight: "900" }, safetyPauseScrim: { ...StyleSheet.absoluteFill, zIndex: 55, justifyContent: "flex-end", backgroundColor: "rgba(10,12,10,0.42)" }, safetyPauseSheet: { backgroundColor: colors.paper, borderTopLeftRadius: 30, borderTopRightRadius: 30, paddingHorizontal: 22, paddingTop: 12, paddingBottom: 38, gap: 10 }, safetyPauseTitle: { color: colors.ink, fontSize: 24, fontWeight: "900" }, safetyPauseDetail: { color: colors.ink2, fontSize: 13, lineHeight: 19, marginBottom: 4 }, safetyPauseChoice: { minHeight: 50, paddingHorizontal: 14, borderRadius: radius.row, backgroundColor: colors.white, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, safetyPauseChoiceText: { flex: 1, color: colors.ink, fontSize: 14, fontWeight: "800" }, safetyPauseCancel: { minHeight: 46, borderRadius: radius.chip, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.line }, safetyPauseCancelText: { color: colors.ink2, fontSize: 14, fontWeight: "800" }, skipSetSheet: { backgroundColor: colors.paper, borderTopLeftRadius: 30, borderTopRightRadius: 30, paddingHorizontal: 22, paddingTop: 12, paddingBottom: 38, gap: 10 }, skipSetTitle: { color: colors.ink, fontSize: 24, fontWeight: "900" }, skipSetDetail: { color: colors.ink2, fontSize: 13, lineHeight: 19 }, skipSetInput: { minHeight: 86, borderRadius: radius.row, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white, color: colors.ink, paddingHorizontal: 13, paddingVertical: 11, textAlignVertical: "top", fontSize: 14 }, skipSetConfirm: { minHeight: 48, borderRadius: radius.chip, alignItems: "center", justifyContent: "center", backgroundColor: colors.dark }, skipSetConfirmText: { color: colors.white, fontWeight: "900", fontSize: 15 }, finishButton: { borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white, minHeight: 48, borderRadius: radius.chip, alignItems: "center", justifyContent: "center" }, finishButtonText: { color: colors.ink, fontWeight: "800" }, pausedPage: { flex: 1, padding: 20, justifyContent: "center", backgroundColor: colors.paper }, pausedCard: { backgroundColor: colors.dark, padding: 24, borderRadius: 28, gap: 13 }, pausedTitle: { color: colors.white, fontSize: 30, fontWeight: "900" }, pausedDetail: { color: "#B7BBB3", fontSize: 14, lineHeight: 21, marginBottom: 8 },
  monitorEntry: { minHeight: 62, backgroundColor: colors.white, borderRadius: radius.row, paddingHorizontal: 15, paddingVertical: 10, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, monitorEntryTitle: { color: colors.ink, fontSize: 13, fontWeight: "800" }, monitorEntrySub: { color: colors.ink3, fontSize: 11, marginTop: 3 }, monitorEntryButton: { minWidth: 54, minHeight: 34, borderRadius: radius.chip, alignItems: "center", justifyContent: "center", backgroundColor: colors.dark }, monitorEntryButtonText: { color: colors.lime, fontSize: 12, fontWeight: "900" }, nextSetRecommendation: { backgroundColor: "#EEF9C7", borderRadius: radius.card, minHeight: 84, padding: 14, flexDirection: "row", alignItems: "center", gap: 12 }, nextSetRecommendationBody: { flex: 1, gap: 2 }, nextSetRecommendationTitle: { color: colors.ink, fontSize: 15, fontWeight: "900" }, nextSetRecommendationDetail: { color: colors.ink2, fontSize: 11, lineHeight: 16 }, nextSetRecommendationButton: { minWidth: 58, minHeight: 38, borderRadius: radius.chip, backgroundColor: colors.dark, alignItems: "center", justifyContent: "center", paddingHorizontal: 12 }, nextSetRecommendationButtonText: { color: colors.lime, fontSize: 12, fontWeight: "900" },
  restCard: { backgroundColor: "#EEF9C7", borderRadius: radius.card, minHeight: 72, paddingHorizontal: 16, paddingVertical: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, restTime: { color: colors.ink, fontFamily: "monospace", fontSize: 24, fontWeight: "900", marginTop: 2 }, restActions: { flexDirection: "row", alignItems: "center", gap: 8 }, restAdd: { backgroundColor: colors.dark, borderRadius: radius.chip, minHeight: 38, paddingHorizontal: 12, alignItems: "center", justifyContent: "center" }, restAddText: { color: colors.lime, fontSize: 12, fontWeight: "900" }, restCancel: { backgroundColor: colors.white, borderColor: colors.line, borderWidth: 1, borderRadius: radius.chip, minHeight: 38, paddingHorizontal: 14, alignItems: "center", justifyContent: "center" }, restCancelText: { color: colors.ink, fontSize: 12, fontWeight: "800" },
  inlineError: { position: "absolute", left: 18, right: 18, bottom: 92, backgroundColor: colors.terraSoft, padding: 10, borderRadius: 12 }, inlineErrorText: { color: colors.terra, textAlign: "center", fontSize: 12 },
  tabbar: { position: "absolute", bottom: 0, left: 0, right: 0, height: 76, backgroundColor: "rgba(255,255,255,0.96)", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line, flexDirection: "row", paddingTop: 10, paddingBottom: 8 }, tab: { flex: 1, alignItems: "center", gap: 4 }, tabIcon: { color: colors.ink3, fontSize: 18, fontWeight: "700" }, tabLabel: { color: colors.ink3, fontSize: 10 }, tabOn: { color: colors.ink, fontWeight: "900" },
});

const permissionConfigureStyles = StyleSheet.create({
  text: { color: colors.limeInk, fontSize: 12, fontWeight: "900", marginTop: 8 },
});
