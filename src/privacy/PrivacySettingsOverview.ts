import type { PermissionSetData, PermissionStatus } from "../coach/domain";

/**
 * The small, safe read model used by the mobile privacy/account screen.
 *
 * This is intentionally a disclosure surface rather than a new account or
 * product-data transport. It carries no credentials, external account identifiers,
 * remote envelopes or raw product payloads.
 */
export interface PrivacySettingsOverview {
  account: {
    availability: "available";
    state: "authenticated";
  };
  remoteModel: {
    authorization: PermissionStatus;
    consent: RemoteModelConsentDisclosure;
    configuration: RemoteModelConfigurationDisclosure;
  };
  /**
   * 诊断 trace 上报：独立开关、默认关闭、以 remoteLlm 授权为前提。
   * 上报内容只有元数据与假名引用，永远不含对话文本。
   */
  observability: {
    authorization: PermissionStatus;
    uploads: "metadata_only";
    /** 授权关闭时本地诊断日志照常可用，只是不出设备。 */
    localDiagnostics: "always_local";
    effective: boolean;
  };
  /** Capability disclosure only; archived bytes and recovery material stay local. */
  backup: {
    capability: "available" | "unavailable";
    encryption: "client_side";
    content: "structured_data_only";
  };
}

/** The explicit, task-relevant disclosure shown before remote model use. */
export type RemoteModelConsentDisclosure =
  | {
      status: "not_active";
      includedCategories: readonly RemoteModelIncludedCategory[];
      removedDirectIdentityFields: readonly RemoteModelRemovedField[];
    }
  | {
      status: "review_required";
      includedCategories: readonly RemoteModelIncludedCategory[];
      removedDirectIdentityFields: readonly RemoteModelRemovedField[];
    }
  | {
      status: "active";
      ref: string;
      grantedAt: string;
      includedCategories: readonly RemoteModelIncludedCategory[];
      removedDirectIdentityFields: readonly RemoteModelRemovedField[];
    };

export type RemoteModelIncludedCategory =
  | "身体"
  | "训练表现"
  | "饮食"
  | "恢复与睡眠"
  | "Timeline 经历";

export type RemoteModelRemovedField =
  | "姓名"
  | "地址"
  | "联系方式"
  | "精确位置"
  | "外部账号标识";

/** The client can only use MaxPower's managed cloud capability. */
export type RemoteModelConfigurationDisclosure = {
  status: "managed_cloud";
  service: "MaxPower Cloud";
};

export interface BuildPrivacySettingsOverviewInput {
  userId: string;
  /** AuthRoot-created account namespace; never serialized into the overview. */
  authenticatedAccountId: string;
  permissions?: { revision: number; value: PermissionSetData };
  backupCryptoAvailability: "available" | "unavailable";
}

const includedCategories = [
  "身体",
  "训练表现",
  "饮食",
  "恢复与睡眠",
  "Timeline 经历",
] as const satisfies readonly RemoteModelIncludedCategory[];

const removedFields = [
  "姓名",
  "地址",
  "联系方式",
  "精确位置",
  "外部账号标识",
] as const satisfies readonly RemoteModelRemovedField[];

/**
 * Builds a UI-safe, user-scoped disclosure. A request for a different local
 * profile is rejected before any account-scoped disclosure is returned.
 */
export function buildPrivacySettingsOverview(input: BuildPrivacySettingsOverviewInput): PrivacySettingsOverview {
  const permission = input.permissions?.value;
  const remoteAuthorization = permission?.remoteLlm ?? "not_configured";
  assertAuthenticatedAccount(input.userId, input.authenticatedAccountId);
  return {
    account: { availability: "available", state: "authenticated" },
    remoteModel: {
      authorization: remoteAuthorization,
      consent: remoteModelDisclosure(permission, input.permissions?.revision),
      configuration: { status: "managed_cloud", service: "MaxPower Cloud" },
    },
    observability: {
      authorization: permission?.observability ?? "not_configured",
      uploads: "metadata_only",
      localDiagnostics: "always_local",
      effective: permission?.observability === "granted" && remoteAuthorization === "granted",
    },
    backup: {
      capability: input.backupCryptoAvailability,
      encryption: "client_side",
      content: "structured_data_only",
    },
  };
}

function assertAuthenticatedAccount(userId: string, accountId: string): void {
  if (!accountId.trim()) throw new Error("authenticated_account_context_required");
  if (userId !== accountId) throw new Error("privacy_account_context_mismatch");
}

function remoteModelDisclosure(
  permissions: PermissionSetData | undefined,
  revision: number | undefined,
): RemoteModelConsentDisclosure {
  const disclosure = permissions?.remoteLlmDisclosure;
  if (permissions?.remoteLlm !== "granted") {
    return {
      status: "not_active",
      includedCategories,
      removedDirectIdentityFields: removedFields,
    };
  }
  if (!disclosure || revision === undefined) {
    return {
      status: "review_required",
      includedCategories,
      removedDirectIdentityFields: removedFields,
    };
  }
  return {
    status: "active",
    ref: `permission:${permissions.id}:${revision}`,
    grantedAt: disclosure.consentedAt,
    includedCategories,
    // The stored consent remains the source of truth. Do not turn a future
    // narrower disclosure into a broader UI claim merely because this build
    // knows additional redaction categories.
    removedDirectIdentityFields: disclosure.directIdentityFieldsRemoved.map(labelRemovedField),
  };
}

function labelRemovedField(
  field: NonNullable<PermissionSetData["remoteLlmDisclosure"]>["directIdentityFieldsRemoved"][number],
): RemoteModelRemovedField {
  return field === "name" ? "姓名" :
    field === "address" ? "地址" :
    field === "contact_details" ? "联系方式" :
    field === "precise_location" ? "精确位置" : "外部账号标识";
}
