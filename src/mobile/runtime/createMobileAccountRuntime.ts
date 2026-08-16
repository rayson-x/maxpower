import { Platform } from "react-native";

import { LocalProductKernel } from "../../coach";
import { PiAgentConversationModule, createLocalConversationAdapters } from "../../agent-conversation";
import { RecordModule } from "../../records";
import {
  BehaviorDecisionTraceRecorder,
  createTraceWriter,
  createExpoTraceFileSystem,
} from "../../observability";
import {
  InMemoryPersonalKnowledgeStore,
  PersonalKnowledgeLayer,
} from "../../knowledge/personalLayer";
import type { NotificationPort } from "../../coach/ports";
import { InMemorySecureCredentialPort, WebCryptoBackupCryptoPort } from "../../privacy";
import type { AccountRuntime, AccountRuntimeCreateInput } from "../auth/model";
import { createCloudCoachServices } from "../cloud";
import {
  ANDROID_HEALTH_CONNECT_MVP_METRICS,
  APPLE_HEALTHKIT_MVP_METRICS,
  createExpoBackgroundSchedulerPort,
  createExpoNotificationPort,
  createExpoSecureCredentialPort,
  openExpoMaxPowerPersistence,
  tryCreateExpoAndroidHealthConnectPort,
  tryCreateExpoAppleHealthKitPort,
} from "../native";
import type { ProductShellStateStore } from "../ui/ProductShellStateStore";
import type { ProductShellRecovery } from "../ui/productNavigation";
import { openWebMaxPowerPersistence } from "./WebLocalPersistence";

export interface MobileAccountRuntime extends AccountRuntime {
  application: LocalProductKernel;
  conversation: PiAgentConversationModule;
  records: RecordModule;
  productShellStateStore: ProductShellStateStore;
  initialProductShellRecovery: ProductShellRecovery;
  notifications?: NotificationPort;
  /** Reads the latest in-memory JWT owned by OnlineAuthController. */
  serviceAccessToken(): string;
}

export interface MobileAccountRuntimeOptions {
  apiBaseUrl: string;
}

/** Composition seam shared by AuthRoot and the authenticated text LLM service. */
export function createMobileAccountRuntimeFactory(options: MobileAccountRuntimeOptions) {
  return (input: AccountRuntimeCreateInput): Promise<MobileAccountRuntime> =>
    createMobileAccountRuntime(input, options);
}

/** Builds all mutable mobile services under one authenticated account owner. */
export async function createMobileAccountRuntime(
  input: AccountRuntimeCreateInput,
  options?: MobileAccountRuntimeOptions,
): Promise<MobileAccountRuntime> {
  assertActive(input.signal);
  const apiBaseUrl = options?.apiBaseUrl ?? process.env.EXPO_PUBLIC_MAXPOWER_API_BASE_URL?.trim();
  if (!apiBaseUrl) throw new Error("maxpower_api_base_url_required");
  const persistence = Platform.OS === "web"
    ? await openWebMaxPowerPersistence(input.accountId)
    : await openExpoMaxPowerPersistence(input.accountId);
  let application: LocalProductKernel | undefined;
  let conversation: PiAgentConversationModule | undefined;
  let records: RecordModule | undefined;
  let disposed = false;

  try {
    assertActive(input.signal);
    let sequence = 0;
    const notifications = Platform.OS === "web" ? undefined : createExpoNotificationPort();
    const backgroundScheduler = Platform.OS === "web" ? undefined : createExpoBackgroundSchedulerPort();
    const health = Platform.OS === "web"
      ? undefined
      : tryCreateExpoAndroidHealthConnectPort() ?? tryCreateExpoAppleHealthKitPort();
    const credentials = Platform.OS === "web"
      ? new InMemorySecureCredentialPort()
      : createExpoSecureCredentialPort();
    const accessTokens = {
      accessTokenFor(accountId: string) {
        if (accountId !== input.accountId) throw new Error("cloud_account_mismatch");
        return input.accessToken();
      },
    };
    const cloudCoach = createCloudCoachServices({
      apiBaseUrl,
      accountId: input.accountId,
      accessTokens,
      accountSignal: input.signal,
    });
    // The agent and Planner both write through this decorated local Ledger.
    // Trace envelopes contain only opaque refs and closed reason codes; they
    // never retain user text or provider reasoning. The device file is for
    // local diagnostics only and is not uploaded by this composition.
    const traceWriter = Platform.OS === "web"
      ? undefined
      : createTraceWriter({
          ledger: persistence.ledger,
          runtime: {
            now: () => new Date().toISOString(),
            nextId: (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(++sequence).toString(36)}`,
          },
          config: {
            deviceId: `mobile:${input.accountId}`,
            localFile: { directory: `maxpower/traces/${input.accountId}` },
          },
          files: createExpoTraceFileSystem(),
        });
    const appLedger = traceWriter?.ledger ?? persistence.ledger;
    await traceWriter?.reconcile();

    const runtime = {
      now: () => new Date().toISOString(),
      nextId: (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(++sequence).toString(36)}`,
    };
    const kernel = new LocalProductKernel({
      ledger: appLedger,
      authenticatedAccountId: input.accountId,
      runtime,
      notifications,
      backgroundScheduler,
      health,
      credentials,
      ...(traceWriter ? { behaviorDecisionRecorder: new BehaviorDecisionTraceRecorder(traceWriter.recorder) } : {}),
      backupCrypto: new WebCryptoBackupCryptoPort(),
      afterFixedGoalPathReview: async ({ userId, causationId }) => {
        await conversation?.execute({ kind: "reconcile", userId, causationId });
      },
    });
    application = kernel;
    records = new RecordModule({
      createTimelineDraft: (request) => kernel.createTimelineRecordDraft(request),
      confirmTimelineDraft: (request) => kernel.confirmTimelineRecordDraft(request),
      createNutritionDraft: (request) => kernel.createNutritionObservationDraft(request),
      confirmNutritionDraft: (request) => kernel.confirmNutritionObservationDraft(request),
      correctTimelineFact: (request) => kernel.correctTimelineFact(request),
    });
    conversation = new PiAgentConversationModule({
      ledger: appLedger,
      runtime,
      pi: cloudCoach.pi,
      ...createLocalConversationAdapters({ kernel, records }),
    });

    await application.runDailyGoalPathReview({
      userId: input.accountId,
      idempotencyKey: `daily-goal-path:${localCalendarDate()}`,
      timezoneOffsetMinutes: new Date().getTimezoneOffset() * -1,
    });
    await application.catchUpRecipes(input.accountId);
    assertActive(input.signal);
    const domain = await application.readDomainProjection({ userId: input.accountId });
    const permissions = domain.permissions?.value;
    if (health && permissions?.health === "granted") {
      await application.catchUpHealthEvidence({
        userId: input.accountId,
        platform: health.platform,
        metricTypes: health.platform === "health_connect"
          ? ANDROID_HEALTH_CONNECT_MVP_METRICS
          : APPLE_HEALTHKIT_MVP_METRICS,
        idempotencyKeyPrefix: `foreground-health-catchup:${Date.now().toString(36)}`,
        adapterSchemaVersion: health.platform === "health_connect"
          ? "android-health-connect-v1"
          : "ios-healthkit-v1",
      });
    }
    assertActive(input.signal);
    const localNow = new Date();
    if (domain.profile && localNow.getHours() >= 5 && localNow.getHours() < 12) {
      await application.triggerMorningRecoveryCheckIn({
        userId: input.accountId,
        occurredAt: localNow.toISOString(),
        timezoneOffsetMinutes: localNow.getTimezoneOffset() * -1,
      });
      await application.catchUpRecipes(input.accountId);
    }
    assertActive(input.signal);
    const initialProductShellRecovery = await persistence.productShellStateStore.restore({
      userId: input.accountId,
      fallbackDate: localCalendarDate(),
    });
    assertActive(input.signal);

    return {
      accountId: input.accountId,
      application,
      conversation,
      records,
      productShellStateStore: persistence.productShellStateStore,
      initialProductShellRecovery,
      notifications,
      serviceAccessToken: input.accessToken,
      async dispose() {
        if (disposed) return;
        disposed = true;
        await conversation?.dispose();
        await persistence.dispose();
      },
    };
  } catch (cause) {
    if (!disposed) {
      disposed = true;
      if (application) {
        await conversation?.dispose();
      }
      await persistence.dispose();
    }
    throw cause;
  }
}

function assertActive(signal: AbortSignal): void {
  if (!signal.aborted) return;
  const error = new Error("mobile_account_runtime_aborted");
  error.name = "AbortError";
  throw error;
}

function localCalendarDate(now = new Date()): string {
  const shifted = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 10);
}
