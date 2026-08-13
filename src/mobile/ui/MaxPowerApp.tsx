import React, { useEffect, useState } from "react";
import { Linking, Platform, StatusBar, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView, initialWindowMetrics } from "react-native-safe-area-context";

import type { NotificationPlatformEvent } from "../../coach/ports";
import { InMemorySecureCredentialPort } from "../../privacy";
import {
  AccountRuntimeCoordinator,
  AuthRoot,
  createLinkingSocialAuthorizationPort,
  DeletionRecoveryVault,
  MemoryServiceAccessTokenStore,
  OnlineAuthController,
  SecureSessionVault,
  ServerAuthClient,
  SocialExchangeBindingVault,
  type SocialAuthorizationPort,
} from "../auth";
import { createExpoSecureCredentialPort } from "../native";
import { createMobileAccountRuntimeFactory, type MobileAccountRuntime } from "../runtime";
import { ProductShell } from "./ProductShell";
import { resolveMaxPowerDeepLink } from "./productNavigation";
import { WebInteractionPreview, shouldShowWebInteractionPreview } from "./WebInteractionPreview";
import { colors } from "./theme";

type AuthComposition =
  | {
      status: "ready";
      controller: OnlineAuthController<MobileAccountRuntime>;
      socialAuthorization: SocialAuthorizationPort;
    }
  | { status: "invalid_configuration"; message: string };

/** Mobile composition root: authentication owns whether an account runtime exists. */
export function MaxPowerApp() {
  const [composition] = useState<AuthComposition>(createAuthComposition);
  const [webInteractionPreview] = useState(shouldShowWebInteractionPreview);

  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.paper }}>
        <StatusBar barStyle="dark-content" />
        {webInteractionPreview ? <WebInteractionPreview /> : composition.status === "ready" ? (
          <AuthRoot
            controller={composition.controller}
            socialAuthorization={composition.socialAuthorization}
            renderProduct={({ accountId, runtime, openAccountSettings }) => (
              <AuthenticatedProduct key={accountId} accountId={accountId} runtime={runtime} onOpenAccountSettings={openAccountSettings} />
            )}
          />
        ) : (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 28 }}>
            <Text style={{ color: colors.ink, fontWeight: "900", fontSize: 18 }}>无法安全连接 MaxPower</Text>
            <Text style={{ color: colors.ink2, marginTop: 9, textAlign: "center" }}>{composition.message}</Text>
          </View>
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function AuthenticatedProduct({ accountId, runtime, onOpenAccountSettings }: { accountId: string; runtime: MobileAccountRuntime; onOpenAccountSettings(): void }) {
  const [incomingDeepLink, setIncomingDeepLink] = useState<string>();

  useEffect(() => {
    let mounted = true;
    let stopNotificationObservation: (() => void) | undefined;
    const receiveExternalDeepLink = (url?: string) => {
      if (mounted && resolveMaxPowerDeepLink(url)) setIncomingDeepLink(url);
    };
    const recordNotification = (event: NotificationPlatformEvent) => {
      if (event.event === "dismissed") return;
      void runtime.application.recordNotificationReceipt({
        userId: accountId,
        notificationIntentId: event.notificationId,
        event: event.event,
        occurredAt: event.occurredAt,
      }).catch(() => undefined);
      if (event.event === "tap") receiveExternalDeepLink(event.deepLink);
    };

    void (async () => {
      const lastInteraction = await runtime.notifications?.lastInteraction?.();
      if (!mounted) return;
      if (lastInteraction) recordNotification(lastInteraction);
      stopNotificationObservation = runtime.notifications?.observe?.(recordNotification);
      const initialUrl = await Linking.getInitialURL();
      if (!mounted) {
        stopNotificationObservation?.();
        return;
      }
      receiveExternalDeepLink(initialUrl ?? undefined);
    })();
    const subscription = Linking.addEventListener("url", ({ url }) => receiveExternalDeepLink(url));

    return () => {
      mounted = false;
      stopNotificationObservation?.();
      subscription.remove();
    };
  }, [accountId, runtime]);

  return (
    <ProductShell
      application={runtime.application}
      userId={accountId}
      incomingDeepLink={incomingDeepLink}
      productShellStateStore={runtime.productShellStateStore}
      initialProductShellRecovery={runtime.initialProductShellRecovery}
      confirmedProduct={runtime.confirmedProduct}
      cloudMediaLibrary={runtime.cloudMediaLibrary}
      onTimelineChanged={runtime.settleTimelineRisk}
      onOpenAccountSettings={onOpenAccountSettings}
    />
  );
}

// MVP clients talk directly to the deployed development server. Keep one
// explicit endpoint instead of runtime environment or protocol switches.
const MVP_API_ENDPOINT = "http://54.151.241.139:3000";

function createAuthComposition(): AuthComposition {
  try {
    const baseUrl = MVP_API_ENDPOINT;
    const credentials = Platform.OS === "web"
      // Web development is intentionally process-only; native builds use
      // Keychain/Keystore and no browser storage receives a session token.
      ? new InMemorySecureCredentialPort()
      : createExpoSecureCredentialPort();
    const socialExchangeBinding = new SocialExchangeBindingVault(credentials);
    const auth = new ServerAuthClient({
      baseUrl,
      allowInsecureHttp: true,
      socialExchangeBinding: () => socialExchangeBinding.readOrCreate(),
    });
    const serviceAccessTokens = new MemoryServiceAccessTokenStore();
    const socialAuthorization = createLinkingSocialAuthorizationPort({
      callbackUrl: "maxpower://auth/callback",
      googleEnabled: process.env.EXPO_PUBLIC_MAXPOWER_GOOGLE_AUTH_ENABLED !== "false",
    });
    const controller = new OnlineAuthController<MobileAccountRuntime>({
      reachability: auth,
      auth,
      sessionVault: new SecureSessionVault(credentials),
      deletionRecovery: new DeletionRecoveryVault(credentials),
      serviceAccessTokens,
      runtimes: new AccountRuntimeCoordinator({
        create: createMobileAccountRuntimeFactory({ apiBaseUrl: baseUrl, allowInsecureHttp: true }),
      }),
    });
    return { status: "ready", controller, socialAuthorization };
  } catch (cause) {
    return {
      status: "invalid_configuration",
      message: cause instanceof Error ? cause.message : "客户端服务地址无效。",
    };
  }
}
