import React, { useEffect, useState, type ReactNode } from "react";
import {
  AppState,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import Svg, { Path } from "react-native-svg";

import type {
  AccountRuntime,
  IdentityChannel,
  IdentityPublicConfiguration,
  LinkedIdentity,
  OnlineAuthState,
  SocialAuthorizationPort,
  SocialProvider,
} from "./model";
import type { OnlineAuthController } from "./OnlineAuthController";
import { userFacingError } from "../userFacingError";
import { mobileT } from "../../i18n";


export interface AuthRootProps<TRuntime extends AccountRuntime> {
  controller: OnlineAuthController<TRuntime>;
  socialAuthorization?: SocialAuthorizationPort;
  renderProduct(input: {
    accountId: string;
    displayName: string;
    runtime: TRuntime;
    openAccountSettings(): void;
  }): ReactNode;
}

/** Product runtime gate. No authenticated state means no product subtree. */
export function AuthRoot<TRuntime extends AccountRuntime>({
  controller,
  socialAuthorization,
  renderProduct,
}: AuthRootProps<TRuntime>) {
  const [state, setState] = useState<OnlineAuthState<TRuntime>>(controller.currentState());
  const [accountSettingsOpen, setAccountSettingsOpen] = useState(false);

  useEffect(() => {
    let mounted = true;
    const unsubscribe = controller.subscribe((next) => {
      if (mounted) setState(next);
    });
    void controller.bootstrap();
    const probe = () => void controller.ensureReachable();
    const interval = setInterval(probe, 30_000);
    const appState = AppState.addEventListener("change", (next) => {
      if (next === "active") probe();
    });
    return () => {
      mounted = false;
      clearInterval(interval);
      appState.remove();
      unsubscribe();
      void controller.dispose();
    };
  }, [controller]);

  if (state.status === "deleting") {
    return <DeletingAccountGate controller={controller} state={state} />;
  }

  if (state.status === "authenticated") {
    return (
      <View style={{ flex: 1 }}>
        {renderProduct({
          accountId: state.identity.accountId,
          displayName: state.identity.displayName,
          runtime: state.runtime,
          openAccountSettings: () => setAccountSettingsOpen(true),
        })}
        <AuthenticatedAccountControls
          controller={controller}
          socialAuthorization={socialAuthorization}
          open={accountSettingsOpen}
          onClose={() => setAccountSettingsOpen(false)}
        />
      </View>
    );
  }

  if (state.status === "checking" || state.status === "authenticating") {
    return <GateMessage title={state.status === "checking" ? mobileT("mobile.auth.authroot.762fc2335c") : mobileT("mobile.auth.authroot.b3c8b0ef89")} />;
  }

  if (state.status === "offline") {
    return (
      <GateMessage
        title={mobileT("mobile.auth.authroot.fd469ca4ff")}
        detail={mobileT("mobile.auth.authroot.0245591bc9")}
        actionLabel={mobileT("mobile.auth.authroot.e2d53a6d3a")}
        onAction={() => void controller.bootstrap()}
      />
    );
  }

  if (state.status === "error") {
    return (
      <GateMessage
        title={mobileT("mobile.auth.authroot.217225225e")}
        detail={friendlyError(state.error.code)}
        actionLabel={mobileT("mobile.auth.authroot.e2d53a6d3a")}
        onAction={() => void controller.bootstrap()}
      />
    );
  }

  return (
    <CredentialScreen
      controller={controller}
      socialAuthorization={socialAuthorization}
      initialError={state.error?.code}
    />
  );
}

function AuthenticatedAccountControls<TRuntime extends AccountRuntime>({
  controller,
  socialAuthorization,
  open,
  onClose,
}: {
  controller: OnlineAuthController<TRuntime>;
  socialAuthorization?: SocialAuthorizationPort;
  open: boolean;
  onClose(): void;
}) {
  const [identities, setIdentities] = useState<readonly LinkedIdentity[]>([]);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const refreshIdentities = async () => setIdentities(await controller.listLinkedIdentities());
  useEffect(() => {
    if (!open) return;
    setError(undefined);
    void refreshIdentities().catch((cause) => setError(friendlyCause(cause)));
    // Account identity reads are explicit and the controller is stable here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, controller]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (cause) {
      setError(friendlyCause(cause));
    } finally {
      setBusy(false);
    }
  };

  const link = (provider: SocialProvider) => void run(async () => {
    if (!socialAuthorization) throw new Error(mobileT("mobile.auth.authroot.9306944290"));
    const result = await controller.linkSocialIdentity(provider, socialAuthorization);
    if (result === "linked") await refreshIdentities();
  });
  const unlink = (identity: LinkedIdentity) => void run(async () => {
    setIdentities(await controller.unlinkIdentity(identity));
  });

  if (!open) return null;

  const availableProviders = socialAuthorization?.availableProviders() ?? [];
  return (
    <View style={{ position: "absolute", inset: 0, backgroundColor: "rgba(23,22,19,0.45)", justifyContent: "center", padding: 24 }}>
      <View style={{ borderRadius: 18, padding: 20, backgroundColor: "#fffdf9" }}>
        <Text style={{ color: "#171613", fontSize: 20, fontWeight: "900" }}>{mobileT("mobile.auth.authroot.7a66bc8dab")}</Text>
        <Text style={{ color: "#69635a", marginTop: 6 }}>{mobileT("mobile.auth.authroot.151708c69c")}</Text>
        {identities.map((identity) => (
          <View key={identity.id} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 10 }}>
            <Text style={{ color: "#34312c", fontWeight: "700" }}>{identityLabel(identity.providerId)}</Text>
            {identities.length > 1 ? (
              <Pressable disabled={busy} onPress={() => unlink(identity)}>
                <Text style={{ color: "#9b3b32", fontWeight: "700" }}>{mobileT("mobile.auth.authroot.25a139280f")}</Text>
              </Pressable>
            ) : null}
          </View>
        ))}
        {availableProviders
          .filter((provider) => !identities.some((identity) => identity.providerId === provider))
          .map((provider) => (
            <PrimaryButton
              key={provider}
              label={mobileT("mobile.auth.authroot.aa3ca8b7cb", { value0: providerLabel(provider) })}
              disabled={busy}
              onPress={() => link(provider)}
            />
          ))}

        <Text style={{ color: "#9b3b32", fontWeight: "900", marginTop: 24 }}>{mobileT("mobile.auth.authroot.326ee09bb9")}</Text>
        <Text style={{ color: "#69635a", marginTop: 5, marginBottom: 9 }}>
          {mobileT("mobile.auth.authroot.739d319562")}</Text>
        <Field
          value={deleteConfirmation}
          onChangeText={setDeleteConfirmation}
          placeholder={mobileT("mobile.account.deleteConfirmationPlaceholder")}
          autoCapitalize="characters"
        />
        <PrimaryButton
          label={mobileT("mobile.auth.authroot.867ee16597")}
          disabled={busy || deleteConfirmation !== "DELETE"}
          onPress={() => void run(() => controller.deleteAccount())}
        />
        <PrimaryButton label={mobileT("mobile.auth.authroot.6a8052d6eb")} disabled={busy} onPress={() => void controller.logout()} />
        <Pressable disabled={busy} onPress={onClose} style={{ alignItems: "center", padding: 14 }}>
          <Text style={{ color: "#4e4941", fontWeight: "800" }}>{mobileT("mobile.auth.authroot.6c14bd7f6f")}</Text>
        </Pressable>
        {error ? <Text style={{ color: "#a33c32", marginTop: 8 }}>{error}</Text> : null}
      </View>
    </View>
  );
}

function DeletingAccountGate<TRuntime extends AccountRuntime>({
  controller,
  state,
}: {
  controller: OnlineAuthController<TRuntime>;
  state: Extract<OnlineAuthState<TRuntime>, { status: "deleting" }>;
}) {
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (state.deletion.status === "completed") return;
    const refresh = () => void controller.refreshDeletionStatus().catch((cause) => setError(friendlyCause(cause)));
    const interval = setInterval(refresh, 3_000);
    return () => clearInterval(interval);
  }, [controller, state.deletion.status]);

  const completed = state.deletion.status === "completed";
  return (
    <GateMessage
      title={completed ? mobileT("mobile.auth.authroot.8c09721d17") : mobileT("mobile.auth.authroot.ca49f68c2f")}
      detail={error ?? deletionStatusCopy(state.deletion.status)}
      actionLabel={completed ? mobileT("mobile.auth.authroot.f2fe4ecc0f") : mobileT("mobile.auth.authroot.8cf2c88f98")}
      onAction={() => void (completed
        ? controller.acknowledgeCompletedDeletion()
        : controller.refreshDeletionStatus().catch((cause) => setError(friendlyCause(cause))))}
    />
  );
}

function CredentialScreen<TRuntime extends AccountRuntime>({
  controller,
  socialAuthorization,
  initialError,
}: {
  controller: OnlineAuthController<TRuntime>;
  socialAuthorization?: SocialAuthorizationPort;
  initialError?: string;
}) {
  const { height: viewportHeight } = useWindowDimensions();
  const compactLayout = viewportHeight < 740;
  const [configuration, setConfiguration] = useState<IdentityPublicConfiguration>();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [method, setMethod] = useState<"password" | "otp">("password");
  const [channel, setChannel] = useState<IdentityChannel>("email");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [challengeId, setChallengeId] = useState<string>();
  const [registrationId, setRegistrationId] = useState<string>();
  const [socialSessionToken, setSocialSessionToken] = useState<string>();
  const [configurationLoading, setConfigurationLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(initialError ? friendlyError(initialError) : undefined);

  const loadConfiguration = () => {
    setConfigurationLoading(true);
    setError(undefined);
    void controller.getPublicConfiguration()
      .then(setConfiguration)
      .catch((cause) => setError(friendlyCause(cause)))
      .finally(() => setConfigurationLoading(false));
  };

  useEffect(() => {
    loadConfiguration();
    // The controller is stable for this account gate. Retrying is explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controller]);

  const identity = { kind: channel, value: identifier } as const;
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (cause) {
      setError(friendlyCause(cause));
    } finally {
      setBusy(false);
    }
  };

  const begin = () => void run(async () => {
    if (!identifier.trim()) throw new Error(channel === "email" ? mobileT("mobile.auth.authroot.f2dc24deb8") : mobileT("mobile.auth.authroot.81e88c4256"));
    if (mode === "login" && method === "password") {
      if (!password) throw new Error(mobileT("mobile.auth.authroot.713b738250"));
      await controller.loginWithPassword({ identifier: identity, password });
      return;
    }
    const challenge = mode === "register"
      ? await controller.startRegistrationOtp({ identifier: identity })
      : await controller.startLoginOtp({ identifier: identity });
    setChallengeId(challenge.challengeId);
  });

  const verify = () => void run(async () => {
    if (!challengeId || !code.trim()) throw new Error(mobileT("mobile.auth.authroot.e5bd79ee38"));
    if (mode === "login") {
      await controller.verifyLoginOtp({ challengeId, code });
      return;
    }
    const result = await controller.verifyRegistrationOtp({ challengeId, code });
    if (result.status === "registration_required") setRegistrationId(result.registrationId);
  });

  const completeRegistration = () => void run(async () => {
    if (!configuration) throw new Error(mobileT("mobile.auth.authroot.a3c7ce6d4e"));
    if (!displayName.trim()) throw new Error(mobileT("mobile.auth.authroot.5dbe6b07eb"));
    if (!termsAccepted) throw new Error(mobileT("mobile.auth.authroot.061ef519ff"));
    if (socialSessionToken) {
      await controller.completeSocialOnboarding({
        sessionToken: socialSessionToken,
        displayName,
        termsVersion: configuration.requiredTermsVersion,
      });
      return;
    }
    if (!registrationId) throw new Error(mobileT("mobile.auth.authroot.90db67fff1"));
    if (password.length < 8) throw new Error(mobileT("mobile.auth.authroot.67ac940574"));
    await controller.completeRegistration({
      registrationId,
      displayName,
      password,
      termsVersion: configuration.requiredTermsVersion,
    });
  });

  const signInWithSocial = (provider: SocialProvider) => void run(async () => {
    if (!socialAuthorization) throw new Error(mobileT("mobile.auth.authroot.ced5d16716"));
    const result = await controller.signInWithSocial(provider, socialAuthorization);
    if (result.status === "onboarding_required") setSocialSessionToken(result.sessionToken);
  });

  const resetFlow = (nextMode: "login" | "register") => {
    setMode(nextMode);
    setMethod(nextMode === "register" ? "otp" : "password");
    setChallengeId(undefined);
    setRegistrationId(undefined);
    setSocialSessionToken(undefined);
    setCode("");
    setError(undefined);
  };
  const selectLoginMethod = (nextMethod: "password" | "otp") => {
    resetFlow("login");
    setMethod(nextMethod);
  };
  const toggleChannel = () => {
    setChannel((current) => current === "email" ? "phone" : "email");
    setIdentifier("");
    setError(undefined);
  };
  const deviceSocialProviders = socialAuthorization?.availableProviders() ?? [];
  const eligibleSocialProviders = configuration
    ? configuration.socialProviders.filter((provider) => deviceSocialProviders.includes(provider))
    : deviceSocialProviders;
  const socialProviders = (["apple", "google"] as const)
    .filter((provider) => eligibleSocialProviders.includes(provider));

  const initialStep = !challengeId && !registrationId && !socialSessionToken;

  return (
    <ScrollView
      style={credentialStyles.screen}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[credentialStyles.page, compactLayout && credentialStyles.pageCompact]}
      showsVerticalScrollIndicator={false}
    >
      <View style={credentialStyles.brandRow}>
        <MaxPowerMark size={30} />
        <Text style={credentialStyles.brandName}>MAXPOWER</Text>
      </View>

      <View style={[credentialStyles.main, compactLayout && credentialStyles.mainCompact]}>
        <View style={[credentialStyles.form, compactLayout && credentialStyles.formCompact]}>
        {initialStep ? (
          <>
            <View style={credentialStyles.welcome}>
              <Text style={credentialStyles.welcomeTitle}>
                {mode === "login" ? mobileT("mobile.auth.welcomeBack") : mobileT("mobile.auth.createAccount")}
              </Text>
              <Text style={credentialStyles.welcomeSubtitle}>
                {mode === "login" ? mobileT("mobile.auth.signInSubtitle") : mobileT("mobile.auth.registerSubtitle")}
              </Text>
            </View>

            {socialProviders.length > 0 ? (
              <>
                <View style={credentialStyles.socialStack}>
                  {socialProviders.map((provider) => (
                    <LoginSocialButton
                      key={provider}
                      provider={provider}
                      disabled={busy}
                      onPress={() => signInWithSocial(provider)}
                    />
                  ))}
                </View>
                <View style={credentialStyles.divider}>
                  <View style={credentialStyles.rule} />
                  <Text style={credentialStyles.dividerLabel}>{mobileT("mobile.auth.separator.or")}</Text>
                  <View style={credentialStyles.rule} />
                </View>
              </>
            ) : null}

            <LoginField
              label={channel === "email" ? mobileT("mobile.auth.authroot.9ed627bcf6") : mobileT("mobile.auth.authroot.5a9cc5e891")}
              action={mode === "login" && method === "otp" ? (
                <LoginLink
                  label={`${mobileT("mobile.auth.authroot.c839a8ff17")}${mobileT("mobile.auth.authroot.21f1e88275")}`}
                  onPress={() => selectLoginMethod("password")}
                  compact
                />
              ) : undefined}
              value={identifier}
              onChangeText={setIdentifier}
              placeholder={channel === "email" ? mobileT("mobile.auth.identifier.emailPlaceholder") : mobileT("mobile.auth.identifier.phonePlaceholder")}
              keyboardType={channel === "email" ? "email-address" : "phone-pad"}
              autoCapitalize="none"
            />
            {mode === "login" && method === "password" ? (
              <LoginField
                label={mobileT("mobile.auth.authroot.c839a8ff17")}
                action={(
                  <LoginLink
                    label={`${mobileT("mobile.auth.authroot.3e3d59a258")}${mobileT("mobile.auth.authroot.21f1e88275")}`}
                    onPress={() => selectLoginMethod("otp")}
                    compact
                  />
                )}
                value={password}
                onChangeText={setPassword}
                placeholder={mobileT("mobile.auth.authroot.c839a8ff17")}
                secureTextEntry
              />
            ) : null}
            <LoginPrimaryButton
              label={mode === "login" && method === "password" ? mobileT("mobile.auth.authroot.21f1e88275") : mobileT("mobile.auth.authroot.42e8edb226")}
              disabled={busy || (mode === "register" && !configuration)}
              onPress={begin}
            />

            <View style={credentialStyles.secondaryActions}>
              {mode === "login" ? (
                <>
                  <LoginLink
                    label={`${channel === "email" ? mobileT("mobile.auth.authroot.5a9cc5e891") : mobileT("mobile.auth.authroot.9ed627bcf6")}${mobileT("mobile.auth.authroot.21f1e88275")}`}
                    onPress={toggleChannel}
                  />
                  <View style={credentialStyles.signupRow}>
                    <Text style={credentialStyles.signupPrompt}>{mobileT("mobile.auth.noAccount")}</Text>
                    <LoginLink label={mobileT("mobile.auth.authroot.da0e5f8dc9")} onPress={() => resetFlow("register")} emphasis />
                  </View>
                </>
              ) : (
                <>
                  <LoginLink
                    label={`${channel === "email" ? mobileT("mobile.auth.authroot.5a9cc5e891") : mobileT("mobile.auth.authroot.9ed627bcf6")}${mobileT("mobile.auth.authroot.da0e5f8dc9")}`}
                    onPress={toggleChannel}
                  />
                  <LoginLink label={mobileT("mobile.auth.authroot.f2fe4ecc0f")} onPress={() => resetFlow("login")} emphasis />
                </>
              )}
            </View>
          </>
        ) : registrationId || socialSessionToken ? (
          <>
            <Text style={credentialStyles.stepTitle}>{mobileT("mobile.auth.authroot.f8a66a8828")}</Text>
            <LoginField label={mobileT("mobile.auth.authroot.25124ed74c")} value={displayName} onChangeText={setDisplayName} placeholder={mobileT("mobile.auth.authroot.25124ed74c")} />
            {registrationId ? (
              <LoginField label={mobileT("mobile.auth.authroot.c839a8ff17")} value={password} onChangeText={setPassword} placeholder={mobileT("mobile.auth.authroot.ececf3b0e9")} secureTextEntry />
            ) : null}
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: termsAccepted }}
              onPress={() => setTermsAccepted((value) => !value)}
              style={credentialStyles.termsRow}
            >
              <View style={[credentialStyles.checkbox, termsAccepted && credentialStyles.checkboxChecked]}>
                <Text style={credentialStyles.checkmark}>{termsAccepted ? "✓" : ""}</Text>
              </View>
              <Text style={credentialStyles.termsText}>{mobileT("mobile.auth.authroot.e28298f99f")}</Text>
            </Pressable>
            <LoginPrimaryButton
              label={socialSessionToken ? mobileT("mobile.auth.authroot.9f784ab3c4") : mobileT("mobile.auth.authroot.f3db8bcde1")}
              disabled={busy || !configuration}
              onPress={completeRegistration}
            />
          </>
        ) : (
          <>
            <Text style={credentialStyles.stepTitle}>{mobileT("mobile.auth.authroot.4e09cf222e")}</Text>
            <LoginField label={mobileT("mobile.auth.authroot.3e3d59a258")} value={code} onChangeText={setCode} placeholder={mobileT("mobile.auth.authroot.3e3d59a258")} keyboardType="number-pad" />
            <LoginPrimaryButton label={mobileT("mobile.auth.authroot.80144e2e73")} disabled={busy} onPress={verify} />
          </>
        )}

        {!configuration && !configurationLoading ? (
          <Pressable onPress={loadConfiguration} style={credentialStyles.retry}>
            <Text style={credentialStyles.retryText}>{mobileT("mobile.auth.authroot.d0b5fc4a94")}</Text>
          </Pressable>
        ) : null}
          {error ? <Text style={credentialStyles.error}>{error}</Text> : null}
        </View>
      </View>
    </ScrollView>
  );
}

function MaxPowerMark({ size = 152 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 1024 1024" accessibilityLabel="MaxPower">
      <Path d="M196 714 L342 326 L506 632 L704 214 L838 714" fill="none" stroke="#C6F135" strokeWidth={116} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function SocialProviderGlyph({ provider }: { provider: SocialProvider }) {
  if (provider === "apple") return <Text style={credentialStyles.appleGlyph}></Text>;
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24" accessibilityLabel="Google">
      <Path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <Path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <Path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <Path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </Svg>
  );
}

function LoginField({
  label,
  action,
  ...props
}: React.ComponentProps<typeof TextInput> & { label: string; action?: ReactNode }) {
  return (
    <View style={credentialStyles.fieldGroup}>
      <View style={credentialStyles.fieldHeader}>
        <Text style={credentialStyles.fieldLabel}>{label}</Text>
        {action}
      </View>
      <TextInput
        {...props}
        accessibilityLabel={props.accessibilityLabel ?? label}
        placeholderTextColor="#9A9E96"
        style={credentialStyles.input}
      />
    </View>
  );
}

function LoginSocialButton({ provider, disabled, onPress }: { provider: SocialProvider; disabled: boolean; onPress(): void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [credentialStyles.socialButton, pressed && credentialStyles.pressed, disabled && credentialStyles.disabled]}
    >
      <View style={credentialStyles.socialIcon}>
        <SocialProviderGlyph provider={provider} />
      </View>
      <Text style={credentialStyles.socialLabel}>
        {mobileT("mobile.auth.authroot.13d1178fe4", { value0: providerLabel(provider) })}
      </Text>
    </Pressable>
  );
}

function LoginPrimaryButton({ label, disabled, onPress }: { label: string; disabled?: boolean; onPress(): void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [credentialStyles.primaryButton, pressed && credentialStyles.pressed, disabled && credentialStyles.disabled]}
    >
      <Text style={credentialStyles.primaryLabel}>{label}</Text>
    </Pressable>
  );
}

function LoginLink({
  label,
  onPress,
  compact = false,
  emphasis = false,
}: {
  label: string;
  onPress(): void;
  compact?: boolean;
  emphasis?: boolean;
}) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} hitSlop={compact ? 10 : 8}>
      <Text style={[credentialStyles.link, compact && credentialStyles.compactLink, emphasis && credentialStyles.emphasisLink]}>{label}</Text>
    </Pressable>
  );
}

const credentialStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F5F6F3" },
  page: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 26, paddingBottom: 22, backgroundColor: "#F5F6F3" },
  pageCompact: { paddingTop: 20, paddingBottom: 18 },
  brandRow: { minHeight: 32, flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 8 },
  brandName: { color: "#171A17", fontSize: 13, lineHeight: 16, fontWeight: "900", letterSpacing: 0.9 },
  main: { flexGrow: 1, alignItems: "center", justifyContent: "center", paddingVertical: 38 },
  mainCompact: { paddingVertical: 24 },
  form: { width: "100%", maxWidth: 384, alignSelf: "center", gap: 18 },
  formCompact: { gap: 15 },
  welcome: { gap: 5, marginBottom: 7 },
  welcomeTitle: { color: "#171A17", fontSize: 30, lineHeight: 36, fontWeight: "800", letterSpacing: -0.8 },
  welcomeSubtitle: { color: "#757A72", fontSize: 14, lineHeight: 20, fontWeight: "500" },
  socialStack: { gap: 10 },
  socialButton: { minHeight: 52, position: "relative", flexDirection: "row", alignItems: "center", justifyContent: "center", borderRadius: 10, borderWidth: 1, borderColor: "#D7DBD3", backgroundColor: "#FFFFFF" },
  socialIcon: { position: "absolute", left: 17, width: 22, alignItems: "center", justifyContent: "center" },
  appleGlyph: { color: "#0E100E", fontSize: 20, lineHeight: 22, fontWeight: "700" },
  socialLabel: { color: "#20231F", fontSize: 14, fontWeight: "700" },
  divider: { minHeight: 20, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 12 },
  rule: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: "#D4D8D0" },
  dividerLabel: { color: "#8A8F87", fontSize: 12, fontWeight: "600" },
  fieldGroup: { gap: 7 },
  fieldHeader: { minHeight: 20, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  fieldLabel: { color: "#383C36", fontSize: 13, fontWeight: "700" },
  input: { minHeight: 52, paddingHorizontal: 15, borderRadius: 10, borderWidth: 1, borderColor: "#D7DBD3", backgroundColor: "#FFFFFF", color: "#171A17", fontSize: 15, fontWeight: "500" },
  primaryButton: { minHeight: 54, alignItems: "center", justifyContent: "center", borderRadius: 10, backgroundColor: "#171A17" },
  primaryLabel: { color: "#FFFFFF", fontSize: 15, fontWeight: "800" },
  pressed: { opacity: 0.68, transform: [{ scale: 0.985 }] },
  disabled: { opacity: 0.42 },
  secondaryActions: { alignItems: "center", gap: 14, paddingTop: 1 },
  signupRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  signupPrompt: { color: "#7C8179", fontSize: 13, fontWeight: "500" },
  link: { color: "#555B52", fontSize: 13, fontWeight: "700" },
  compactLink: { color: "#4C5E22", fontSize: 13 },
  emphasisLink: { color: "#242822", fontWeight: "800", textDecorationLine: "underline" },
  stepTitle: { marginBottom: 5, color: "#171A17", fontSize: 26, lineHeight: 32, fontWeight: "800", letterSpacing: -0.5 },
  termsRow: { minHeight: 38, flexDirection: "row", alignItems: "center", gap: 9 },
  checkbox: { width: 18, height: 18, alignItems: "center", justifyContent: "center", borderRadius: 5, borderWidth: 1, borderColor: "#9A9E96" },
  checkboxChecked: { borderColor: "#9BC918", backgroundColor: "#C6F135" },
  checkmark: { color: "#0E100E", fontSize: 11, fontWeight: "900" },
  termsText: { flex: 1, color: "#6C7168", fontSize: 11, lineHeight: 16 },
  retry: { minHeight: 30, alignItems: "center", justifyContent: "center" },
  retryText: { color: "#526600", fontSize: 11, fontWeight: "800" },
  error: { color: "#A33C32", fontSize: 11, lineHeight: 16, textAlign: "center" },
});

function Field(props: React.ComponentProps<typeof TextInput>) {
  return (
    <TextInput
      {...props}
      placeholderTextColor="#9a9387"
      style={{
        minHeight: 48,
        borderWidth: 1,
        borderColor: "#d5cec1",
        borderRadius: 12,
        paddingHorizontal: 14,
        marginBottom: 10,
        backgroundColor: "#fffdf9",
        color: "#171613",
        fontSize: 16,
      }}
    />
  );
}

function PrimaryButton({ label, disabled, onPress }: { label: string; disabled?: boolean; onPress(): void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 48,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 12,
        marginTop: 6,
        backgroundColor: disabled ? "#b9b3a8" : pressed ? "#14573e" : "#1f6b4d",
      })}
    >
      <Text style={{ color: "#fff", fontWeight: "900", fontSize: 16 }}>{label}</Text>
    </Pressable>
  );
}

function GateMessage({
  title,
  detail,
  actionLabel,
  onAction,
}: {
  title: string;
  detail?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 28, backgroundColor: "#f7f3eb" }}>
      <Text style={{ color: "#171613", fontWeight: "900", fontSize: 18, textAlign: "center" }}>{title}</Text>
      {detail ? <Text style={{ color: "#69635a", marginTop: 9, textAlign: "center" }}>{detail}</Text> : null}
      {actionLabel && onAction ? <PrimaryButton label={actionLabel} onPress={onAction} /> : null}
    </View>
  );
}

function friendlyCause(cause: unknown): string {
  const code = cause && typeof cause === "object" && "code" in cause && typeof cause.code === "string"
    ? cause.code
    : "request_failed";
  return userFacingError(cause, friendlyError(code));
}

function friendlyError(code: string): string {
  if (code === "network_unavailable") return mobileT("mobile.auth.authroot.d820a2ba23");
  if (code === "not_authenticated") return mobileT("mobile.auth.authroot.85b4aca4cc");
  if (code === "secure_storage_unavailable") return mobileT("mobile.auth.authroot.bcaf612a85");
  if (code === "configuration_error") return mobileT("mobile.auth.authroot.cb650519e5");
  if (code === "account_mismatch") return mobileT("mobile.auth.authroot.98278cda57");
  return mobileT("mobile.auth.authroot.0681cf2c60");
}

function providerLabel(provider: "google" | "apple"): string {
  return provider === "google" ? "Google" : "Apple";
}

function identityLabel(providerId: string): string {
  if (providerId === "google") return "Google";
  if (providerId === "apple") return "Apple";
  if (providerId === "credential") return mobileT("mobile.auth.authroot.8a091f8cd6");
  return providerId;
}

function deletionStatusCopy(status: "pending" | "running" | "retryable" | "completed"): string {
  if (status === "pending") return mobileT("mobile.auth.authroot.74e5b5f777");
  if (status === "running") return mobileT("mobile.auth.authroot.4417152905");
  if (status === "retryable") return mobileT("mobile.auth.authroot.4f9186f1d9");
  return mobileT("mobile.auth.authroot.130dbb066b");
}
