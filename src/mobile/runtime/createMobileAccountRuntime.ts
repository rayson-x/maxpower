import { Platform } from "react-native";

import { CoachApplication } from "../../coach";
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
import { InMemoryMediaBlobStore, InMemorySecureCredentialPort, WebCryptoBackupCryptoPort } from "../../privacy";
import type { AccountRuntime, AccountRuntimeCreateInput } from "../auth/model";
import {
  CloudMediaLibrary,
  XhrMediaByteTransferPort,
  createCloudCoachServices,
} from "../cloud";
import {
  LocalConfirmedProductBridge,
  type ConfirmedProductBridge,
  type CloudProductDataFetch,
} from "../product-data";
import {
  ANDROID_HEALTH_CONNECT_MVP_METRICS,
  APPLE_HEALTHKIT_MVP_METRICS,
  createExpoBackgroundSchedulerPort,
  createExpoMediaBlobStore,
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
  application: CoachApplication;
  /** Finishes a queued Timeline evaluation after any client-originated write. */
  settleTimelineRisk(): Promise<void>;
  /** Local-authoritative confirmation boundary for Profile/Plan/Workout data. */
  confirmedProduct: ConfirmedProductBridge;
  /** Optional, explicit-upload personal media library for this account. */
  cloudMediaLibrary: CloudMediaLibrary;
  productShellStateStore: ProductShellStateStore;
  initialProductShellRecovery: ProductShellRecovery;
  notifications?: NotificationPort;
  /** Reads the latest in-memory JWT owned by OnlineAuthController. */
  serviceAccessToken(): string;
}

export interface MobileAccountRuntimeOptions {
  apiBaseUrl: string;
  allowInsecureHttp?: boolean;
  fetch?: CloudProductDataFetch;
}

/** Composition seam shared by AuthRoot and the cloud LLM/media tickets. */
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
  let application: CoachApplication | undefined;
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
    const media = Platform.OS === "web"
      ? new InMemoryMediaBlobStore()
      : createExpoMediaBlobStore();
    const accessTokens = {
      accessTokenFor(accountId: string) {
        if (accountId !== input.accountId) throw new Error("cloud_account_mismatch");
        return input.accessToken();
      },
    };
    const cloudCoach = createCloudCoachServices({
      apiBaseUrl,
      ...(options?.allowInsecureHttp === undefined
        ? {}
        : { allowInsecureHttp: options.allowInsecureHttp }),
      accountId: input.accountId,
      accessTokens,
      accountSignal: input.signal,
      ledger: persistence.ledger,
      media,
    });
    const cloudMediaLibrary = new CloudMediaLibrary({
      apiBaseUrl,
      ...(options?.allowInsecureHttp === undefined
        ? {}
        : { allowInsecureHttp: options.allowInsecureHttp }),
      accountId: input.accountId,
      accessTokens,
      byteTransfer: new XhrMediaByteTransferPort(),
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

    application = new CoachApplication({
      ledger: appLedger,
      authenticatedAccountId: input.accountId,
      runtime: {
        now: () => new Date().toISOString(),
        nextId: (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(++sequence).toString(36)}`,
      },
      notifications,
      backgroundScheduler,
      health,
      credentials,
      media,
      llmProviderResolver: cloudCoach.llmProviderResolver,
      nutritionObservationResolver: cloudCoach.nutritionObservationResolver,
      // The shipped Coach uses the same knowledge-aware tool manifest as the
      // headless lifecycle harness. The model still chooses when to search;
      // the registry validates every call against the current local facts.
      knowledgeToolsEnabled: true,
      // MVP: a clear user-stated report may be written by Coach only through
      // the typed, mandate-gated record tools. Estimates still use a review.
      actionToolsEnabled: true,
      ...(traceWriter ? { behaviorDecisionRecorder: new BehaviorDecisionTraceRecorder(traceWriter.recorder) } : {}),
      backupCrypto: new WebCryptoBackupCryptoPort(),
    });

    await application.runPendingTimelineRiskEvaluation({
      userId: input.accountId,
      idempotencyKey: "foreground-timeline-risk",
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
    // Foreground Health import and the optional morning check-in can each add
    // Timeline facts after the resume pass above. Settle their shared current
    // frontier before rendering; unchanged starts remain a no-op.
    await application.runPendingTimelineRiskEvaluation({
      userId: input.accountId,
      idempotencyKey: "foreground-timeline-risk",
    });
    assertActive(input.signal);
    const initialProductShellRecovery = await persistence.productShellStateStore.restore({
      userId: input.accountId,
      fallbackDate: localCalendarDate(),
    });
    assertActive(input.signal);

    const createdApplication = application;
    return {
      accountId: input.accountId,
      application: createdApplication,
      async settleTimelineRisk() {
        await createdApplication.runPendingTimelineRiskEvaluation({
          userId: input.accountId,
          idempotencyKey: "client-timeline-risk",
        });
      },
      confirmedProduct: new LocalConfirmedProductBridge(),
      cloudMediaLibrary,
      productShellStateStore: persistence.productShellStateStore,
      initialProductShellRecovery,
      notifications,
      serviceAccessToken: input.accessToken,
      async dispose() {
        if (disposed) return;
        disposed = true;
        const sessions = await createdApplication
          .listCoachSessions({ userId: input.accountId, status: "active" })
          .catch(() => []);
        await Promise.allSettled(sessions.map((session) =>
          createdApplication.cancelCoachRun({ sessionId: session.id })
        ));
        await persistence.dispose();
      },
    };
  } catch (cause) {
    if (!disposed) {
      disposed = true;
      if (application) {
        const sessions = await application
          .listCoachSessions({ userId: input.accountId, status: "active" })
          .catch(() => []);
        await Promise.allSettled(sessions.map((session) =>
          application?.cancelCoachRun({ sessionId: session.id })
        ));
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
