import type { PermissionStatus } from "../../coach/domain";

/** Native health bridges intentionally expose only the MVP's closed metrics. */
export type NativeHealthMetric =
  | "sleep"
  | "hrv_sdnn"
  | "hrv_rmssd"
  | "resting_heart_rate"
  | "activity"
  | "body_weight"
  | "body_fat_percentage";

export type NativeHealthPlatform = "health_connect" | "healthkit";

/**
 * Minimal boundary used by the native task lifecycle.  The background runner
 * gets no Provider or UI capabilities: it can only repair local Recipe jobs,
 * resume authorized local Health import and create the deterministic morning
 * check-in Recipe.
 */
export interface LocalRecipeCatchUpApplication {
  catchUpRecipes(userId: string): Promise<unknown>;
  readDomainProjection(input: { userId: string }): Promise<{
    profile?: unknown;
    permissions?: { value: { health?: PermissionStatus } };
  }>;
  catchUpHealthEvidence(input: {
    userId: string;
    platform: NativeHealthPlatform;
    metricTypes: readonly NativeHealthMetric[];
    idempotencyKeyPrefix: string;
    adapterSchemaVersion: string;
    maxPages: number;
  }): Promise<unknown>;
  triggerMorningRecoveryCheckIn(input: {
    userId: string;
    occurredAt: string;
    timezoneOffsetMinutes: number;
  }): Promise<unknown>;
}

export interface LocalRecipeCatchUpHealth {
  readonly platform: NativeHealthPlatform;
}

export interface LocalRecipeCatchUpCycleInput {
  application: LocalRecipeCatchUpApplication;
  health?: LocalRecipeCatchUpHealth;
  userId: string;
  now: () => Date;
  metricTypes: readonly NativeHealthMetric[];
  adapterSchemaVersion: string;
  /** Background runs deliberately use a smaller budget than foreground open. */
  maxHealthPages?: number;
}

export interface LocalRecipeCatchUpCycleResult {
  healthRefresh: "skipped" | "completed" | "failed";
  morningCheckIn: "skipped" | "scheduled";
}

/**
 * Runs one best-effort native wake-up against locally durable state.  A
 * transient Health provider failure must not prevent existing Recipe jobs from
 * being repaired or turn a missing wearable read into a missed morning
 * check-in.  The check-in method independently reads committed Timeline facts
 * and consequently degrades to a manual prompt when evidence is absent.
 */
export async function runLocalRecipeCatchUpCycle(
  input: LocalRecipeCatchUpCycleInput,
): Promise<LocalRecipeCatchUpCycleResult> {
  // Use one wall-clock sample for this wake-up. In particular, an execution
  // beginning at 11:59 must not become a no-op because Health paging took it
  // past the local noon boundary before the check-in Recipe was considered.
  const now = input.now();
  const requestedHealthPages = input.maxHealthPages ?? 4;
  const maxHealthPages = Number.isFinite(requestedHealthPages)
    ? Math.max(1, Math.min(12, Math.floor(requestedHealthPages)))
    : 4;
  await input.application.catchUpRecipes(input.userId);
  const domain = await input.application.readDomainProjection({ userId: input.userId });

  let healthRefresh: LocalRecipeCatchUpCycleResult["healthRefresh"] = "skipped";
  if (input.health && domain.permissions?.value.health === "granted") {
    try {
      await input.application.catchUpHealthEvidence({
        userId: input.userId,
        platform: input.health.platform,
        metricTypes: input.metricTypes,
        idempotencyKeyPrefix: `background-health-catchup:${now.getTime().toString(36)}`,
        adapterSchemaVersion: input.adapterSchemaVersion,
        maxPages: maxHealthPages,
      });
      healthRefresh = "completed";
    } catch {
      // Do not elevate a provider/locked-store failure into a failure of the
      // whole background wake-up. No cursor is advanced when import fails, and
      // the next foreground/background pass resumes the same AtomicCommit path.
      healthRefresh = "failed";
    }
  }

  if (!domain.profile || now.getHours() < 5 || now.getHours() >= 12) {
    return { healthRefresh, morningCheckIn: "skipped" };
  }
  await input.application.triggerMorningRecoveryCheckIn({
    userId: input.userId,
    occurredAt: now.toISOString(),
    timezoneOffsetMinutes: now.getTimezoneOffset() * -1,
  });
  // Health import may have created a deterministic recovery Recipe after the
  // first repair pass. Run the outbox once more so both it and the morning
  // check-in can be scheduled through the native notification adapter.
  await input.application.catchUpRecipes(input.userId);
  return { healthRefresh, morningCheckIn: "scheduled" };
}
