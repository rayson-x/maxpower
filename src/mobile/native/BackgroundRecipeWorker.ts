import { LocalProductKernel } from "../../coach";
import { SecureSessionVault } from "../auth/SecureSessionVault";

import { createExpoNotificationPort } from "./ExpoNotificationPort";
import { openExpoMaxPowerPersistence } from "./ExpoMaxPowerPersistence";
import { createExpoSecureCredentialPort } from "./ExpoSecureCredentialPort";
import {
  ANDROID_HEALTH_CONNECT_MVP_METRICS,
  tryCreateExpoAndroidHealthConnectPort,
} from "./AndroidHealthConnectPort";
import {
  APPLE_HEALTHKIT_MVP_METRICS,
  tryCreateExpoAppleHealthKitPort,
} from "./AppleHealthKitPort";
import { runLocalRecipeCatchUpCycle } from "./LocalRecipeCatchUpCycle";

/** Invoked from a globally-defined native background task; no React tree exists. */
export async function runNativeRecipeCatchUp(): Promise<void> {
  const session = await new SecureSessionVault(createExpoSecureCredentialPort()).read();
  // Logout removes this device-local pointer before the foreground runtime is
  // released, so a later best-effort OS wake cannot touch the old account.
  if (!session) return;
  const persistence = await openExpoMaxPowerPersistence(session.accountId);
  let sequence = 0;
  const health = tryCreateExpoAndroidHealthConnectPort() ?? tryCreateExpoAppleHealthKitPort();
  const app = new LocalProductKernel({
    ledger: persistence.ledger,
    runtime: {
      now: () => new Date().toISOString(),
      nextId: (prefix) => `${prefix}-${Date.now().toString(36)}-${(++sequence).toString(36)}`,
    },
    notifications: createExpoNotificationPort(),
    health,
  });
  // BackgroundTask has a best-effort cadence, not a clock alarm. A native
  // local notification remains the delivery mechanism; this path only creates
  // one idempotent morning Recipe after optional local Health import. It never
  // instantiates an Agent Provider or starts an Agent/tool loop.
  try {
    await runLocalRecipeCatchUpCycle({
      application: app,
      health,
      userId: session.accountId,
      now: () => new Date(),
      metricTypes: health?.platform === "health_connect"
        ? ANDROID_HEALTH_CONNECT_MVP_METRICS
        : APPLE_HEALTHKIT_MVP_METRICS,
      adapterSchemaVersion: health?.platform === "health_connect"
        ? "android-health-connect-v1"
        : "ios-healthkit-v1",
    });
    // Always run the same deterministic long-horizon review, even when no new
    // Record was added today. This worker never starts an LLM or changes a plan.
    const localNow = new Date();
    const localDate = new Date(localNow.getTime() - localNow.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
    await app.runDailyGoalPathReview({
      userId: session.accountId,
      idempotencyKey: `daily-goal-path:${localDate}`,
      timezoneOffsetMinutes: localNow.getTimezoneOffset() * -1,
    });
  } finally {
    await persistence.dispose();
  }
}
