import type { CoachLedger } from "../coach/ledger";
import type {
  CoachRecipe,
  CoachRecipeKind,
  FactRef,
  JobAttempt,
  NotificationIntent,
  NotificationKind,
  NotificationReceipt,
  RecipeNotificationSettings,
  RuntimeServices,
  ScheduledJob,
} from "../coach/model";
import type { BackgroundSchedulerPort, NotificationPort } from "../coach/ports";
import { stableHash } from "../coach/stable";

export interface FixedReminderInput {
  userId: string;
  recipeId: string;
  localTime: string;
  timezoneOffsetMinutes: number;
  localDate: string;
  enabled?: boolean;
  quietHours?: { start: string; end: string };
  factFrontier?: readonly FactRef[];
}

/**
 * Event recipes are deliberately declarative. The caller selects one closed
 * recipe kind; it cannot provide executable steps, templates, URLs, or tools.
 */
export interface EventRecipeInput {
  userId: string;
  recipeId: string;
  kind: Exclude<CoachRecipeKind, "fixed_reminder">;
  enabled?: boolean;
  notificationSettings?: RecipeNotificationSettings;
}

export interface RecipeTriggerInput {
  userId: string;
  recipeId: string;
  occurredAt: string;
  causationId: string;
  idempotencyKey: string;
  timezoneOffsetMinutes: number;
  localDateIntent: string;
  factFrontier: readonly FactRef[];
  /** An explicit bounded window; it is not a promise of exact OS execution. */
  dueWindowMinutes?: number;
  ruleVersions?: Readonly<Record<string, string>>;
  recoveryEvidence?: "available" | "unavailable";
  trainingInProgress?: boolean;
}

export interface UpdateEventRecipeInput {
  userId: string;
  recipeId: string;
  enabled: boolean;
  notificationSettings?: RecipeNotificationSettings;
}

export interface RecipeCatchUpResult {
  attempted: readonly string[];
  scheduledNotificationIds: readonly string[];
  expiredJobIds: readonly string[];
  skippedJobIds: readonly string[];
}

/** First-party registry; adding a recipe means adding a typed product contract. */
export const DEFAULT_EVENT_RECIPE_KINDS = [
  "session_completed_assessment",
  "morning_check_in",
  "recovery_changed",
  "today_plan_changed",
  "missed_session_review",
  "schedule_or_equipment_changed",
  "weekly_review",
  "deload_ended",
] as const satisfies readonly Exclude<CoachRecipeKind, "fixed_reminder">[];

/**
 * Local-only closed Recipe runner. It never calls a language provider or changes a plan;
 * recipes only persist/cancel notification intents through the same ledger used by the app.
 */
export class LocalRecipeEngine {
  constructor(
    private readonly ledger: CoachLedger,
    private readonly runtime: RuntimeServices,
    private readonly notifications?: NotificationPort,
    private readonly scheduler?: BackgroundSchedulerPort,
    private readonly currentRuleVersions: () => Readonly<Record<string, string>> = () => ({ recipe_registry: "v1" }),
  ) {}

  async upsertFixedReminder(input: FixedReminderInput): Promise<{ recipe: CoachRecipe; job: ScheduledJob }> {
    assertLocalTime(input.localTime);
    assertLocalDate(input.localDate);
    assertTimezoneOffset(input.timezoneOffsetMinutes);
    const snapshot = await this.ledger.read();
    const existing = snapshot.coachRecipes.find(
      (recipe) => recipe.id === input.recipeId && recipe.userId === input.userId,
    );
    const version = (existing?.version ?? 0) + 1;
    const now = this.runtime.now();
    const recipe: CoachRecipe = {
      id: input.recipeId,
      userId: input.userId,
      kind: "fixed_reminder",
      schemaVersion: 1,
      version,
      enabled: input.enabled ?? true,
      fixedReminder: {
        localTime: input.localTime,
        timezoneOffsetMinutes: input.timezoneOffsetMinutes,
        notificationKind: "record_reminder",
        ...(input.quietHours ? { quietHours: input.quietHours } : {}),
      },
      notificationSettings: {
        ...(input.quietHours ? { quietHours: input.quietHours } : {}),
      },
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    const dueAt = localDateTimeToIso(input.localDate, input.localTime, input.timezoneOffsetMinutes);
    const jobId = `recipe-job-${stableHash({ userId: input.userId, recipeId: input.recipeId, localDate: input.localDate })}`;
    const job: ScheduledJob = {
      id: jobId,
      userId: input.userId,
      recipeId: recipe.id,
      recipeVersion: recipe.version,
      trigger: {
        id: `trigger-${stableHash({ jobId, version })}`,
        recipeId: recipe.id,
        kind: "fixed_reminder",
        occurredAt: now,
        causationId: recipe.id,
        idempotencyKey: `fixed-reminder:${jobId}:v${version}`,
        factFrontier: input.factFrontier ?? [],
        ruleVersions: this.recipeRuleVersions(),
      },
      earliestAt: dueAt,
      latestAt: new Date(Date.parse(dueAt) + 2 * 60 * 60 * 1000).toISOString(),
      expiresAt: new Date(Date.parse(dueAt) + 24 * 60 * 60 * 1000).toISOString(),
      timezoneOffsetMinutes: input.timezoneOffsetMinutes,
      localDateIntent: input.localDate,
      coalescingKey: `fixed-reminder:${input.userId}:${input.localDate}`,
      status: recipe.enabled ? "scheduled" : "cancelled",
      lastEvaluatedFrontier: input.factFrontier ?? [],
      createdAt: now,
      updatedAt: now,
    };
    await this.ledger.commit({
      kind: "domain",
      userId: input.userId,
      actorId: "recipe_engine",
      intent: "recipe.fixed_reminder.upsert",
      expectedRevisions: [],
      domainEvents: [],
      coachRecipes: [recipe],
      scheduledJobs: [job],
      idempotencyKey: `recipe-upsert:${job.id}:v${version}`,
      recordedAt: now,
    });
    const supersededIntents = snapshot.notificationIntents.filter(
      (intent) =>
        intent.userId === input.userId &&
        intent.jobId === job.id &&
        intent.status !== "cancelled" &&
        intent.status !== "failed",
    );
    if (supersededIntents.length) {
      await this.cancelSupersededIntents(job, supersededIntents, now);
    }
    if (recipe.enabled && this.scheduler) {
      await this.scheduler.upsert({ id: job.id, earliestAt: job.earliestAt, latestAt: job.latestAt, expiresAt: job.expiresAt });
    }
    // Native local notifications can be scheduled at the user-confirmed wall
    // time. Background work remains a best-effort recovery path; it is never
    // the mechanism that makes a future reminder precise.
    if (recipe.enabled && this.notifications?.upsert && Date.parse(job.earliestAt) > Date.parse(now)) {
      const intent = notificationForJob(job, recipe, now, notificationIntentId(job));
      await this.scheduleNotificationForJob(job, intent, now);
    }
    return { recipe, job };
  }

  /** Create or update a closed, event-driven recipe without scheduling it yet. */
  async upsertEventRecipe(input: EventRecipeInput): Promise<CoachRecipe> {
    assertEventRecipeKind(input.kind);
    assertNotificationSettings(input.notificationSettings);
    const snapshot = await this.ledger.read();
    const existing = snapshot.coachRecipes.find(
      (recipe) => recipe.id === input.recipeId && recipe.userId === input.userId,
    );
    if (existing && existing.kind !== input.kind) throw new Error("recipe_kind_immutable");
    const now = this.runtime.now();
    const recipe: CoachRecipe = {
      id: input.recipeId,
      userId: input.userId,
      kind: input.kind,
      schemaVersion: 1,
      version: (existing?.version ?? 0) + 1,
      enabled: input.enabled ?? true,
      ...(input.notificationSettings ? { notificationSettings: input.notificationSettings } : {}),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await this.ledger.commit({
      kind: "domain",
      userId: input.userId,
      actorId: "recipe_engine",
      intent: "recipe.event.upsert",
      expectedRevisions: [],
      domainEvents: [],
      coachRecipes: [recipe],
      idempotencyKey: `recipe-event-upsert:${recipe.id}:v${recipe.version}`,
      recordedAt: now,
    });
    return recipe;
  }

  /**
   * Installs the product's event recipe registry for a user without firing a
   * notification. Existing user settings always win over the initial defaults.
   */
  async ensureDefaultEventRecipes(userId: string): Promise<readonly CoachRecipe[]> {
    const existing = await this.ledger.read();
    const installed: CoachRecipe[] = [];
    for (const kind of DEFAULT_EVENT_RECIPE_KINDS) {
      const recipeId = `default-recipe:${kind}`;
      const prior = existing.coachRecipes.find((recipe) => recipe.userId === userId && recipe.id === recipeId);
      installed.push(prior ?? await this.upsertEventRecipe({ userId, recipeId, kind }));
    }
    return installed;
  }

  /**
   * User-facing configuration path for an existing event recipe. It cannot
   * change the recipe kind or register untrusted background behavior.
   */
  async updateEventRecipe(input: UpdateEventRecipeInput): Promise<CoachRecipe | undefined> {
    const snapshot = await this.ledger.read();
    const existing = snapshot.coachRecipes.find((recipe) => recipe.id === input.recipeId && recipe.userId === input.userId);
    if (!existing) return undefined;
    assertEventRecipeKind(existing.kind);
    return this.upsertEventRecipe({
      userId: input.userId,
      recipeId: existing.id,
      kind: existing.kind,
      enabled: input.enabled,
      notificationSettings: input.notificationSettings ?? existing.notificationSettings,
    });
  }

  /**
   * Persist an event trigger for later best-effort local evaluation. This is a
   * scheduling operation only: it cannot commit a plan or invoke an LLM.
   */
  async triggerRecipe(input: RecipeTriggerInput): Promise<ScheduledJob> {
    assertLocalDate(input.localDateIntent);
    assertIsoTimestamp(input.occurredAt, "invalid_trigger_time");
    assertTimezoneOffset(input.timezoneOffsetMinutes);
    if (!input.idempotencyKey || !input.causationId) throw new Error("invalid_recipe_trigger_identity");
    if (input.dueWindowMinutes !== undefined && (!Number.isInteger(input.dueWindowMinutes) || input.dueWindowMinutes < 1 || input.dueWindowMinutes > 24 * 60)) {
      throw new Error("invalid_recipe_due_window");
    }
    const snapshot = await this.ledger.read();
    const recipe = snapshot.coachRecipes.find((item) => item.id === input.recipeId && item.userId === input.userId);
    if (!recipe) throw new Error("recipe_not_found");
    assertEventRecipeKind(recipe.kind);
    const existingByTrigger = snapshot.scheduledJobs.find(
      (job) => job.userId === input.userId && job.trigger.idempotencyKey === input.idempotencyKey,
    );
    if (existingByTrigger) return existingByTrigger;

    const notificationKind = notificationKindForRecipe(recipe.kind, input.recoveryEvidence);
    const coalescingKey = `recipe-event:${input.userId}:${notificationKind}:${input.localDateIntent}`;
    const dueWindowMinutes = input.dueWindowMinutes ?? 2 * 60;
    const earliestAt = input.occurredAt;
    const trigger = {
      id: `trigger-${stableHash({ recipeId: recipe.id, idempotencyKey: input.idempotencyKey })}`,
      recipeId: recipe.id,
      kind: recipe.kind,
      occurredAt: input.occurredAt,
      causationId: input.causationId,
      idempotencyKey: input.idempotencyKey,
      factFrontier: input.factFrontier,
      ruleVersions: { ...this.recipeRuleVersions(), ...(input.ruleVersions ?? {}) },
      ...(input.recoveryEvidence ? { recoveryEvidence: input.recoveryEvidence } : {}),
      ...(input.trainingInProgress ? { trainingInProgress: true } : {}),
    } as const;
    const existingCoalesced = snapshot.scheduledJobs.find(
      (job) =>
        job.userId === input.userId &&
        job.coalescingKey === coalescingKey &&
        (job.status === "scheduled" || job.status === "notification_scheduled"),
    );
    if (existingCoalesced) {
      const now = this.runtime.now();
      const replacesScheduledNotification = existingCoalesced.status === "notification_scheduled";
      const cancelledIntents = replacesScheduledNotification
        ? snapshot.notificationIntents.filter(
            (intent) =>
              intent.userId === input.userId &&
              intent.jobId === existingCoalesced.id &&
              (intent.status === "pending" || intent.status === "scheduled"),
          )
        : [];
      const coalesced: ScheduledJob = {
        ...existingCoalesced,
        recipeId: recipe.id,
        recipeVersion: recipe.version,
        trigger,
        earliestAt,
        latestAt: new Date(Date.parse(earliestAt) + dueWindowMinutes * 60_000).toISOString(),
        expiresAt: new Date(Date.parse(earliestAt) + 24 * 60 * 60 * 1000).toISOString(),
        timezoneOffsetMinutes: input.timezoneOffsetMinutes,
        localDateIntent: input.localDateIntent,
        status: recipe.enabled ? "scheduled" : "cancelled",
        lastEvaluatedFrontier: input.factFrontier,
        updatedAt: now,
      };
      await this.ledger.commit({
        kind: "domain",
        userId: input.userId,
        actorId: "recipe_engine",
        intent: "recipe.event.coalesce",
        expectedRevisions: [],
        domainEvents: [],
        scheduledJobs: [coalesced],
        ...(cancelledIntents.length
          ? {
              notificationIntents: cancelledIntents.map((intent) => ({ ...intent, status: "cancelled" as const, updatedAt: now })),
              notificationReceipts: cancelledIntents.map((intent) => ({
                id: `receipt-${stableHash({ intent: intent.id, event: "cancelled", trigger: trigger.id })}`,
                userId: input.userId,
                notificationIntentId: intent.id,
                event: "cancelled" as const,
                occurredAt: now,
              })),
            }
          : {}),
        idempotencyKey: `recipe-event-coalesce:${existingCoalesced.id}:${input.idempotencyKey}`,
        recordedAt: now,
      });
      if (this.scheduler && recipe.enabled) {
        await this.scheduler.upsert({ id: coalesced.id, earliestAt: coalesced.earliestAt, latestAt: coalesced.latestAt, expiresAt: coalesced.expiresAt });
      }
      if (cancelledIntents.length && this.notifications) {
        await Promise.all(cancelledIntents.map((intent) => this.notifications!.cancel(intent.id)));
      }
      return coalesced;
    }

    const jobId = `recipe-job-${stableHash({ userId: input.userId, recipeId: recipe.id, trigger: input.idempotencyKey })}`;
    const job: ScheduledJob = {
      id: jobId,
      userId: input.userId,
      recipeId: recipe.id,
      recipeVersion: recipe.version,
      trigger,
      earliestAt,
      latestAt: new Date(Date.parse(earliestAt) + dueWindowMinutes * 60_000).toISOString(),
      expiresAt: new Date(Date.parse(earliestAt) + 24 * 60 * 60 * 1000).toISOString(),
      timezoneOffsetMinutes: input.timezoneOffsetMinutes,
      localDateIntent: input.localDateIntent,
      coalescingKey,
      status: recipe.enabled ? "scheduled" : "cancelled",
      lastEvaluatedFrontier: input.factFrontier,
      createdAt: this.runtime.now(),
      updatedAt: this.runtime.now(),
    };
    await this.ledger.commit({
      kind: "domain",
      userId: input.userId,
      actorId: "recipe_engine",
      intent: "recipe.event.trigger",
      expectedRevisions: [],
      domainEvents: [],
      scheduledJobs: [job],
      idempotencyKey: `recipe-event-trigger:${job.id}`,
      recordedAt: this.runtime.now(),
    });
    if (recipe.enabled && this.scheduler) {
      await this.scheduler.upsert({ id: job.id, earliestAt: job.earliestAt, latestAt: job.latestAt, expiresAt: job.expiresAt });
    }
    return job;
  }

  private recipeRuleVersions(): Readonly<Record<string, string>> {
    return { recipe_registry: "v1", ...this.currentRuleVersions() };
  }

  async catchUp(userId: string, now = this.runtime.now()): Promise<RecipeCatchUpResult> {
    const snapshot = await this.ledger.read();
    const jobs = snapshot.scheduledJobs.filter(
      (job) => job.userId === userId && (job.status === "scheduled" || job.status === "running"),
    );
    const attempted: string[] = [];
    const scheduledNotificationIds: string[] = [];
    const expiredJobIds: string[] = [];
    const skippedJobIds: string[] = [];
    for (const job of jobs) {
      if (Date.parse(job.earliestAt) > Date.parse(now)) continue;
      const recipe = snapshot.coachRecipes.find((candidate) => candidate.id === job.recipeId && candidate.userId === userId);
      if (!recipe?.enabled) {
        await this.persistTerminalJob(job, "cancelled", "recipe_disabled", now);
        skippedJobIds.push(job.id);
        continue;
      }
      if (Date.parse(now) > Date.parse(job.expiresAt)) {
        await this.persistTerminalJob(job, "expired", "due_window_expired", now);
        expiredJobIds.push(job.id);
        continue;
      }
      const intendedKind = notificationKindForRecipe(recipe.kind, job.trigger.recoveryEvidence);
      const settings = recipe.notificationSettings;
      if (settings?.doNotDisturb) {
        await this.persistTerminalJob(job, "skipped", "notification_dnd", now);
        skippedJobIds.push(job.id);
        continue;
      }
      if (settings?.enabledNotificationKinds && !settings.enabledNotificationKinds.includes(intendedKind)) {
        await this.persistTerminalJob(job, "skipped", "notification_kind_disabled", now);
        skippedJobIds.push(job.id);
        continue;
      }
      if (settings?.suppressDuringWorkout && job.trigger.trainingInProgress) {
        await this.persistTerminalJob(job, "skipped", "training_in_progress", now);
        skippedJobIds.push(job.id);
        continue;
      }
      const quietHours = settings?.quietHours ?? recipe.fixedReminder?.quietHours;
      if (quietHours && isWithinQuietHours(now, job.timezoneOffsetMinutes, quietHours)) {
        await this.persistTerminalJob(job, "skipped", "quiet_hours", now);
        skippedJobIds.push(job.id);
        continue;
      }
      const maxPerLocalDate = settings?.maxPerLocalDate ?? defaultMaxPerLocalDate(recipe.kind);
      const alreadyScheduled = snapshot.notificationIntents.filter(
        (intent) =>
          intent.userId === job.userId &&
          intent.kind === intendedKind &&
          intent.localDateIntent === job.localDateIntent &&
          intent.jobId !== job.id &&
          (intent.status === "pending" || intent.status === "scheduled"),
      ).length;
      if (alreadyScheduled >= maxPerLocalDate) {
        await this.persistTerminalJob(job, "skipped", "notification_frequency_cap", now);
        skippedJobIds.push(job.id);
        continue;
      }
      // A local ledger must never claim a notification was delivered when the
      // platform adapter is not installed (for example in a CLI/offline test host).
      if (!this.notifications) {
        await this.persistTerminalJob(job, "skipped", "notification_port_unavailable", now);
        skippedJobIds.push(job.id);
        continue;
      }
      const intentId = notificationIntentId(job);
      const existingIntent = snapshot.notificationIntents.find(
        (intent) => intent.id === intentId && (intent.status === "pending" || intent.status === "scheduled"),
      );
      const intent = existingIntent ?? notificationForJob(job, recipe, now, intentId);
      attempted.push(job.id);
      const scheduled = await this.scheduleNotificationForJob(job, intent, now);
      if (scheduled) {
        scheduledNotificationIds.push(intent.id);
      }
    }
    return { attempted, scheduledNotificationIds, expiredJobIds, skippedJobIds };
  }

  async cancelRecipe(userId: string, recipeId: string): Promise<void> {
    const snapshot = await this.ledger.read();
    const recipe = snapshot.coachRecipes.find((item) => item.id === recipeId && item.userId === userId);
    if (!recipe) return;
    const now = this.runtime.now();
    const jobs = snapshot.scheduledJobs.filter(
      (job) =>
        job.recipeId === recipeId &&
        job.userId === userId &&
        job.status !== "delivered" &&
        job.status !== "cancelled",
    );
    const intents = snapshot.notificationIntents.filter((intent) => jobs.some((job) => job.id === intent.jobId) && intent.status !== "cancelled");
    await this.ledger.commit({
      kind: "domain", userId, actorId: "recipe_engine", intent: "recipe.cancel", expectedRevisions: [], domainEvents: [],
      coachRecipes: [{ ...recipe, enabled: false, version: recipe.version + 1, updatedAt: now }],
      scheduledJobs: jobs.map((job) => ({ ...job, status: "cancelled" as const, updatedAt: now })),
      notificationIntents: intents.map((intent) => ({ ...intent, status: "cancelled" as const, updatedAt: now })),
      notificationReceipts: intents.map((intent) => ({ id: `receipt-${stableHash({ intent: intent.id, event: "cancelled" })}`, userId, notificationIntentId: intent.id, event: "cancelled" as const, occurredAt: now })),
      idempotencyKey: `recipe-cancel:${recipeId}:${recipe.version + 1}`,
      recordedAt: now,
    });
    await Promise.all([
      ...jobs.map((job) => this.scheduler?.cancel(job.id)),
      ...intents.map((intent) => this.notifications?.cancel(intent.id)),
    ]);
  }

  async listJobs(userId: string): Promise<readonly ScheduledJob[]> {
    return (await this.ledger.read()).scheduledJobs.filter((job) => job.userId === userId);
  }

  async listRecipes(userId: string): Promise<readonly CoachRecipe[]> {
    return (await this.ledger.read()).coachRecipes.filter((recipe) => recipe.userId === userId);
  }

  private async persistTerminalJob(job: ScheduledJob, status: "cancelled" | "expired" | "skipped", reason: string, now: string): Promise<void> {
    const attempt = nextAttempt((await this.ledger.read()).jobAttempts, job, now, reason, status === "expired" ? "expired" : "skipped");
    await this.ledger.commit({
      kind: "domain", userId: job.userId, actorId: "recipe_engine", intent: "recipe.job.terminal", expectedRevisions: [], domainEvents: [],
      scheduledJobs: [{ ...job, status, updatedAt: now }], jobAttempts: [attempt],
      idempotencyKey: `recipe-terminal:${job.id}:${status}`, recordedAt: now,
    });
  }

  private async persistNotificationScheduled(job: ScheduledJob, intent: NotificationIntent, now: string, attempt: JobAttempt): Promise<void> {
    const receipt: NotificationReceipt = { id: `receipt-${stableHash({ intent: intent.id, event: "scheduled", trigger: job.trigger.id })}`, userId: job.userId, notificationIntentId: intent.id, event: "scheduled", occurredAt: now };
    await this.ledger.commit({
      kind: "domain", userId: job.userId, actorId: "recipe_engine", intent: "recipe.notification.scheduled", expectedRevisions: [], domainEvents: [],
      scheduledJobs: [{ ...job, status: "notification_scheduled", updatedAt: now }],
      notificationIntents: [{ ...intent, status: "scheduled", updatedAt: now }], notificationReceipts: [receipt], jobAttempts: [attempt],
      idempotencyKey: `recipe-notification:${intent.id}:scheduled:${job.trigger.id}`, recordedAt: now,
    });
  }

  private async persistNotificationFailure(job: ScheduledJob, intent: NotificationIntent, now: string, errorCode: string, attempt: JobAttempt): Promise<void> {
    const receipt: NotificationReceipt = { id: `receipt-${stableHash({ intent: intent.id, event: "failed", errorCode, trigger: job.trigger.id })}`, userId: job.userId, notificationIntentId: intent.id, event: "failed", occurredAt: now, errorCode };
    await this.ledger.commit({
      kind: "domain", userId: job.userId, actorId: "recipe_engine", intent: "recipe.notification.failed", expectedRevisions: [], domainEvents: [],
      scheduledJobs: [{ ...job, status: "failed", updatedAt: now }],
      notificationIntents: [{ ...intent, status: "failed", updatedAt: now }], notificationReceipts: [receipt], jobAttempts: [attempt],
      idempotencyKey: `recipe-notification:${intent.id}:failed:${job.trigger.id}`, recordedAt: now,
    });
  }

  private async scheduleNotificationForJob(job: ScheduledJob, intent: NotificationIntent, now: string): Promise<boolean> {
    if (!this.notifications) return false;
    const snapshot = await this.ledger.read();
    const activeJob = { ...job, status: "running" as const, updatedAt: now };
    const attempt = nextAttempt(snapshot.jobAttempts, job, now, "pending_notification_schedule", "started");
    await this.ledger.commit({
      kind: "domain",
      userId: job.userId,
      actorId: "recipe_engine",
      intent: "recipe.job.attempt",
      expectedRevisions: [],
      domainEvents: [],
      scheduledJobs: [activeJob],
      notificationIntents: [intent],
      jobAttempts: [attempt],
      idempotencyKey: `recipe-attempt:${job.id}:v${job.recipeVersion}:${attempt.attempt}`,
      recordedAt: now,
    });
    try {
      if (this.notifications.upsert) {
        await this.notifications.upsert({ id: intent.id, at: intent.scheduledAt, title: intent.title, body: intent.body, deepLink: encodeDeepLink(intent.deepLink) });
      } else {
        await this.notifications.schedule({ id: intent.id, at: intent.scheduledAt, title: intent.title, body: intent.body });
      }
      await this.persistNotificationScheduled(job, intent, now, { ...attempt, outcome: "scheduled", finishedAt: now });
      return true;
    } catch (error) {
      await this.persistNotificationFailure(
        job,
        intent,
        now,
        error instanceof Error ? error.message : "notification_schedule_failed",
        { ...attempt, outcome: "failed", finishedAt: now },
      );
      return false;
    }
  }

  private async cancelSupersededIntents(
    job: ScheduledJob,
    intents: readonly NotificationIntent[],
    now: string,
  ): Promise<void> {
    if (!this.notifications) return;
    await Promise.all(intents.map((intent) => this.notifications!.cancel(intent.id)));
    await this.ledger.commit({
      kind: "domain",
      userId: job.userId,
      actorId: "recipe_engine",
      intent: "recipe.notification.supersede",
      expectedRevisions: [],
      domainEvents: [],
      notificationIntents: intents.map((intent) => ({ ...intent, status: "cancelled" as const, updatedAt: now })),
      notificationReceipts: intents.map((intent) => ({
        id: `receipt-${stableHash({ intent: intent.id, event: "cancelled", version: job.recipeVersion })}`,
        userId: job.userId,
        notificationIntentId: intent.id,
        event: "cancelled" as const,
        occurredAt: now,
      })),
      idempotencyKey: `recipe-notification-supersede:${job.id}:v${job.recipeVersion}`,
      recordedAt: now,
    });
  }
}

function notificationForJob(job: ScheduledJob, recipe: CoachRecipe, now: string, id: string): NotificationIntent {
  const template = notificationTemplate(recipe.kind, job.trigger.recoveryEvidence);
  const deepLinkRef = recipe.kind === "session_completed_assessment" && template.deepLinkKind === "workout"
    ? job.trigger.causationId
    : job.localDateIntent;
  return {
    id, userId: job.userId, jobId: job.id, kind: template.kind, title: template.title, body: template.body,
    privacy: "lock_screen_safe", deepLink: { kind: template.deepLinkKind, ref: deepLinkRef }, localDateIntent: job.localDateIntent,
    scheduledAt: Date.parse(job.earliestAt) > Date.parse(now) ? job.earliestAt : now,
    status: "pending", createdAt: now, updatedAt: now,
  };
}

function notificationIntentId(job: ScheduledJob): string {
  return `notification-${stableHash({ jobId: job.id, coalescingKey: job.coalescingKey, recipeVersion: job.recipeVersion })}`;
}

type NotificationTemplate = Readonly<{
  kind: NotificationKind;
  title: string;
  body: string;
  deepLinkKind: NotificationIntent["deepLink"]["kind"];
}>;

/**
 * The only notification wording background work can produce. Keep these
 * summaries context-free and privacy-safe: detailed observations always stay
 * behind the unlocked app and a locally-rendered Artifact.
 */
const EVENT_NOTIFICATION_TEMPLATES: Readonly<Record<Exclude<CoachRecipeKind, "morning_check_in">, NotificationTemplate>> = {
  session_completed_assessment: {
    kind: "next_workout_preview",
    title: "训练已记录",
    body: "打开 MaxPower 查看下一次训练准备。",
    deepLinkKind: "workout",
  },
  recovery_changed: {
    kind: "recovery_change",
    title: "今天的安排已更新",
    body: "打开 MaxPower 查看今天的安排。",
    deepLinkKind: "today",
  },
  today_plan_changed: {
    kind: "today_plan_changed",
    title: "今日安排已更新",
    body: "打开 MaxPower 查看最新安排。",
    deepLinkKind: "today",
  },
  missed_session_review: {
    kind: "missed_session_replan",
    title: "今天的安排还没完成",
    body: "打开 MaxPower 查看接下来的安排。",
    deepLinkKind: "today",
  },
  schedule_or_equipment_changed: {
    kind: "next_workout_preview",
    title: "下一次训练可重新安排",
    body: "打开 MaxPower 查看可用动作与时间。",
    deepLinkKind: "workout",
  },
  weekly_review: {
    kind: "weekly_report",
    title: "本周记录已准备好",
    body: "打开 MaxPower 查看本周的训练与恢复。",
    deepLinkKind: "progress",
  },
  deload_ended: {
    kind: "deload_explanation",
    title: "恢复周已结束",
    body: "打开 MaxPower 查看接下来的训练安排。",
    deepLinkKind: "today",
  },
  fixed_reminder: {
    kind: "record_reminder",
    title: "今天的记录",
    body: "打开 MaxPower，补充训练、活动或恢复记录。",
    deepLinkKind: "today",
  },
};

function notificationTemplate(
  kind: CoachRecipeKind,
  recoveryEvidence?: "available" | "unavailable",
): NotificationTemplate {
  if (kind === "morning_check_in") {
    return recoveryEvidence === "available"
      ? {
          kind: "recovery_change",
          title: "今天先看一眼状态",
          body: "打开 MaxPower 查看今天的安排。",
          deepLinkKind: "today",
        }
      : {
          kind: "record_reminder",
          title: "今天先确认一下状态",
          body: "打开 MaxPower，补充今天的恢复感受。",
          deepLinkKind: "today",
        };
  }
  return EVENT_NOTIFICATION_TEMPLATES[kind];
}

function notificationKindForRecipe(
  kind: CoachRecipeKind,
  recoveryEvidence?: "available" | "unavailable",
): NotificationKind {
  return notificationTemplate(kind, recoveryEvidence).kind;
}

function defaultMaxPerLocalDate(kind: CoachRecipeKind): number {
  // One primary decision of each kind per local date avoids a burst when a
  // foreground catch-up observes several facts at once. Fixed reminders are
  // explicitly scheduled by date and receive the same conservative cap.
  switch (kind) {
    case "morning_check_in":
    case "recovery_changed":
    case "weekly_review":
    case "deload_ended":
    case "fixed_reminder":
    case "session_completed_assessment":
    case "today_plan_changed":
    case "missed_session_review":
    case "schedule_or_equipment_changed":
      return 1;
  }
}

function assertEventRecipeKind(kind: CoachRecipeKind): asserts kind is Exclude<CoachRecipeKind, "fixed_reminder"> {
  if (kind === "fixed_reminder") throw new Error("fixed_reminder_requires_wall_clock_input");
  if (!(DEFAULT_EVENT_RECIPE_KINDS as readonly string[]).includes(kind)) throw new Error("unknown_recipe_kind");
}

function assertNotificationSettings(settings?: RecipeNotificationSettings): void {
  if (!settings) return;
  if (settings.maxPerLocalDate !== undefined && (!Number.isInteger(settings.maxPerLocalDate) || settings.maxPerLocalDate < 0 || settings.maxPerLocalDate > 12)) {
    throw new Error("invalid_notification_frequency_cap");
  }
  if (settings.quietHours) {
    assertLocalTime(settings.quietHours.start);
    assertLocalTime(settings.quietHours.end);
  }
  for (const kind of settings.enabledNotificationKinds ?? []) {
    if (!isNotificationKind(kind)) throw new Error("invalid_notification_kind");
  }
}

function isNotificationKind(value: string): value is NotificationKind {
  return [
    "today_plan_changed",
    "next_workout_preview",
    "missed_session_replan",
    "recovery_change",
    "deload_explanation",
    "weekly_report",
    "goal_deviation",
    "record_reminder",
  ].includes(value);
}

function nextAttempt(existing: readonly JobAttempt[], job: ScheduledJob, now: string, reason: string, outcome: JobAttempt["outcome"] = "failed"): JobAttempt {
  const attempt = existing.filter((item) => item.jobId === job.id).length + 1;
  return {
    id: `attempt-${stableHash({ job: job.id, attempt, reason })}`,
    userId: job.userId,
    jobId: job.id,
    attempt,
    startedAt: now,
    ...(outcome === "started" ? {} : { finishedAt: now }),
    outcome,
    reason,
    factFrontier: job.lastEvaluatedFrontier,
    causationId: job.trigger.causationId,
    correlationId: job.trigger.id,
  };
}

function assertLocalTime(value: string): void {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error("invalid_local_time");
}

function assertLocalDate(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("invalid_local_date");
}

function assertTimezoneOffset(value: number): void {
  if (!Number.isInteger(value) || Math.abs(value) > 14 * 60) throw new Error("invalid_timezone_offset");
}

function assertIsoTimestamp(value: string, errorCode: string): void {
  if (!Number.isFinite(Date.parse(value))) throw new Error(errorCode);
}

function localDateTimeToIso(date: string, time: string, offsetMinutes: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day!, hour!, minute!) - offsetMinutes * 60_000).toISOString();
}

function isWithinQuietHours(now: string, offsetMinutes: number, quiet: { start: string; end: string }): boolean {
  assertLocalTime(quiet.start); assertLocalTime(quiet.end);
  const local = new Date(Date.parse(now) + offsetMinutes * 60_000).toISOString().slice(11, 16);
  return quiet.start <= quiet.end
    ? local >= quiet.start && local < quiet.end
    : local >= quiet.start || local < quiet.end;
}

function encodeDeepLink(link: NotificationIntent["deepLink"]): string {
  return `maxpower://${link.kind}/${encodeURIComponent(link.ref)}`;
}
