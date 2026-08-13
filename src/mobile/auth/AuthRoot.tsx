import React, { useEffect, useState, type ReactNode } from "react";
import {
  AppState,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";

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
    return <GateMessage title={state.status === "checking" ? "正在验证登录" : "正在安全登录"} />;
  }

  if (state.status === "offline") {
    return (
      <GateMessage
        title="需要联网才能使用 MaxPower"
        detail="恢复网络后重试；本地账号资料不会在离线状态下打开。"
        actionLabel="重试"
        onAction={() => void controller.bootstrap()}
      />
    );
  }

  if (state.status === "error") {
    return (
      <GateMessage
        title="暂时无法验证账号"
        detail={friendlyError(state.error.code)}
        actionLabel="重试"
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
    if (!socialAuthorization) throw new Error("当前设备不支持社交账号关联");
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
        <Text style={{ color: "#171613", fontSize: 20, fontWeight: "900" }}>账号设置</Text>
        <Text style={{ color: "#69635a", marginTop: 6 }}>已关联的登录方式</Text>
        {identities.map((identity) => (
          <View key={identity.id} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 10 }}>
            <Text style={{ color: "#34312c", fontWeight: "700" }}>{identityLabel(identity.providerId)}</Text>
            {identities.length > 1 ? (
              <Pressable disabled={busy} onPress={() => unlink(identity)}>
                <Text style={{ color: "#9b3b32", fontWeight: "700" }}>解除关联</Text>
              </Pressable>
            ) : null}
          </View>
        ))}
        {availableProviders
          .filter((provider) => !identities.some((identity) => identity.providerId === provider))
          .map((provider) => (
            <PrimaryButton
              key={provider}
              label={`关联 ${providerLabel(provider)}`}
              disabled={busy}
              onPress={() => link(provider)}
            />
          ))}

        <Text style={{ color: "#9b3b32", fontWeight: "900", marginTop: 24 }}>删除账号与全部云端资料</Text>
        <Text style={{ color: "#69635a", marginTop: 5, marginBottom: 9 }}>
          输入 DELETE 确认。删除开始后会立即退出并停止 Coach 服务。
        </Text>
        <Field
          value={deleteConfirmation}
          onChangeText={setDeleteConfirmation}
          placeholder="DELETE"
          autoCapitalize="characters"
        />
        <PrimaryButton
          label="永久删除账号"
          disabled={busy || deleteConfirmation !== "DELETE"}
          onPress={() => void run(() => controller.deleteAccount())}
        />
        <PrimaryButton label="退出当前账号" disabled={busy} onPress={() => void controller.logout()} />
        <Pressable disabled={busy} onPress={onClose} style={{ alignItems: "center", padding: 14 }}>
          <Text style={{ color: "#4e4941", fontWeight: "800" }}>关闭</Text>
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
      title={completed ? "账号资料已删除" : "正在删除账号与云端资料"}
      detail={error ?? deletionStatusCopy(state.deletion.status)}
      actionLabel={completed ? "返回登录" : "刷新进度"}
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(initialError ? friendlyError(initialError) : undefined);

  const loadConfiguration = () => {
    setError(undefined);
    void controller.getPublicConfiguration()
      .then(setConfiguration)
      .catch((cause) => setError(friendlyCause(cause)));
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
    if (!identifier.trim()) throw new Error(channel === "email" ? "请输入邮箱" : "请输入含国家区号的手机号");
    if (mode === "login" && method === "password") {
      if (!password) throw new Error("请输入密码");
      await controller.loginWithPassword({ identifier: identity, password });
      return;
    }
    const challenge = mode === "register"
      ? await controller.startRegistrationOtp({ identifier: identity })
      : await controller.startLoginOtp({ identifier: identity });
    setChallengeId(challenge.challengeId);
  });

  const verify = () => void run(async () => {
    if (!challengeId || !code.trim()) throw new Error("请输入验证码");
    if (mode === "login") {
      await controller.verifyLoginOtp({ challengeId, code });
      return;
    }
    const result = await controller.verifyRegistrationOtp({ challengeId, code });
    if (result.status === "registration_required") setRegistrationId(result.registrationId);
  });

  const completeRegistration = () => void run(async () => {
    if (!configuration) throw new Error("尚未取得注册条款版本");
    if (!displayName.trim()) throw new Error("请输入昵称");
    if (!termsAccepted) throw new Error("请先同意当前服务条款");
    if (socialSessionToken) {
      await controller.completeSocialOnboarding({
        sessionToken: socialSessionToken,
        displayName,
        termsVersion: configuration.requiredTermsVersion,
      });
      return;
    }
    if (!registrationId) throw new Error("注册验证已失效，请重新开始");
    if (password.length < 8) throw new Error("密码至少 8 位");
    await controller.completeRegistration({
      registrationId,
      displayName,
      password,
      termsVersion: configuration.requiredTermsVersion,
    });
  });

  const signInWithSocial = (provider: SocialProvider) => void run(async () => {
    if (!socialAuthorization) throw new Error("当前设备不支持社交登录");
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
  const socialProviders = configuration && socialAuthorization
    ? configuration.socialProviders.filter((provider) =>
        socialAuthorization.availableProviders().includes(provider)
      )
    : [];

  return (
    <View style={{ flex: 1, justifyContent: "center", paddingHorizontal: 28, backgroundColor: "#f7f3eb" }}>
      <Text style={{ color: "#171613", fontSize: 30, fontWeight: "900", letterSpacing: -0.8 }}>MaxPower</Text>
      <Text style={{ color: "#666158", fontSize: 15, marginTop: 8, marginBottom: 24 }}>
        登录后才能打开你的训练、营养与 Coach 数据。
      </Text>

      <View style={{ flexDirection: "row", gap: 8, marginBottom: 16 }}>
        <Choice selected={mode === "login"} label="登录" onPress={() => resetFlow("login")} />
        <Choice selected={mode === "register"} label="注册" onPress={() => resetFlow("register")} />
      </View>

      {!challengeId && !registrationId && !socialSessionToken ? (
        <>
          <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
            <Choice selected={channel === "email"} label="邮箱" onPress={() => setChannel("email")} />
            <Choice selected={channel === "phone"} label="手机号" onPress={() => setChannel("phone")} />
          </View>
          <Field
            value={identifier}
            onChangeText={setIdentifier}
            placeholder={channel === "email" ? "name@example.com" : "+8613800138000"}
            keyboardType={channel === "email" ? "email-address" : "phone-pad"}
            autoCapitalize="none"
          />
          {mode === "login" ? (
            <View style={{ flexDirection: "row", gap: 8, marginVertical: 12 }}>
              <Choice selected={method === "password"} label="密码" onPress={() => setMethod("password")} />
              <Choice selected={method === "otp"} label="验证码" onPress={() => setMethod("otp")} />
            </View>
          ) : null}
          {mode === "login" && method === "password" ? (
            <Field value={password} onChangeText={setPassword} placeholder="密码" secureTextEntry />
          ) : null}
          <PrimaryButton
            label={mode === "login" && method === "password" ? "登录" : "发送验证码"}
            disabled={busy || (mode === "register" && !configuration)}
            onPress={begin}
          />
          {socialProviders.map((provider) => (
            <PrimaryButton
              key={provider}
              label={`使用 ${providerLabel(provider)} 继续`}
              disabled={busy}
              onPress={() => signInWithSocial(provider)}
            />
          ))}
        </>
      ) : registrationId || socialSessionToken ? (
        <>
          <Text style={{ color: "#3e3b35", fontWeight: "700", marginBottom: 10 }}>完成账号资料</Text>
          <Field value={displayName} onChangeText={setDisplayName} placeholder="昵称" />
          {registrationId ? (
            <Field value={password} onChangeText={setPassword} placeholder="设置密码（至少 8 位）" secureTextEntry />
          ) : null}
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: termsAccepted }}
            onPress={() => setTermsAccepted((value) => !value)}
            style={{ flexDirection: "row", alignItems: "center", marginVertical: 12 }}
          >
            <Text style={{ color: termsAccepted ? "#176748" : "#6c675e", fontSize: 15 }}>
              {termsAccepted ? "☑" : "☐"} 我同意当前服务条款
            </Text>
          </Pressable>
          <PrimaryButton
            label={socialSessionToken ? "完成社交账号注册" : "完成注册"}
            disabled={busy || !configuration}
            onPress={completeRegistration}
          />
        </>
      ) : (
        <>
          <Text style={{ color: "#3e3b35", marginBottom: 10 }}>验证码已发送</Text>
          <Field value={code} onChangeText={setCode} placeholder="验证码" keyboardType="number-pad" />
          <PrimaryButton label="验证" disabled={busy} onPress={verify} />
        </>
      )}

      {configuration ? (
        <Text style={{ color: "#8a8378", fontSize: 12, marginTop: 14 }}>
          登录区域：全球
        </Text>
      ) : (
        <Pressable onPress={loadConfiguration} style={{ marginTop: 14 }}>
          <Text style={{ color: "#176748", fontWeight: "700" }}>重新读取登录配置</Text>
        </Pressable>
      )}
      {error ? <Text style={{ color: "#a33c32", marginTop: 12 }}>{error}</Text> : null}
    </View>
  );
}

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

function Choice({ selected, label, onPress }: { selected: boolean; label: string; onPress(): void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={{
        paddingVertical: 8,
        paddingHorizontal: 13,
        borderRadius: 999,
        backgroundColor: selected ? "#1f6b4d" : "#eae4d9",
      }}
    >
      <Text style={{ color: selected ? "#ffffff" : "#49453e", fontWeight: "800" }}>{label}</Text>
    </Pressable>
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
  if (cause instanceof Error && !cause.message.startsWith("online_auth_")) return cause.message;
  const code = cause && typeof cause === "object" && "code" in cause && typeof cause.code === "string"
    ? cause.code
    : "request_failed";
  return friendlyError(code);
}

function friendlyError(code: string): string {
  if (code === "network_unavailable") return "无法连接服务器，请检查网络后重试。";
  if (code === "not_authenticated") return "登录已失效，请重新登录。";
  if (code === "secure_storage_unavailable") return "设备安全存储不可用，无法安全保存登录。";
  if (code === "configuration_error") return "客户端尚未配置有效的 HTTPS 服务地址。";
  if (code === "account_mismatch") return "账号校验不一致，请重新登录。";
  return "登录请求未完成，请检查信息后重试。";
}

function providerLabel(provider: "google" | "apple"): string {
  return provider === "google" ? "Google" : "Apple";
}

function identityLabel(providerId: string): string {
  if (providerId === "google") return "Google";
  if (providerId === "apple") return "Apple";
  if (providerId === "credential") return "邮箱或手机号密码";
  return providerId;
}

function deletionStatusCopy(status: "pending" | "running" | "retryable" | "completed"): string {
  if (status === "pending") return "删除请求已确认，正在等待后台处理。";
  if (status === "running") return "正在清理账号、训练结果、计划、媒体和用量记录。";
  if (status === "retryable") return "部分资料暂未清理完成，服务器会自动重试。";
  return "账号与云端资料已完成删除。";
}
