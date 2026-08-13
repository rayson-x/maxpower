import type { FactRef, HealthAdapterAvailability, HealthImportPermission, HealthMetric } from "../../coach/model";
import type {
  HealthDataPort,
  HealthConnectionState,
  HealthEvidencePage,
  HealthEvidencePageRequest,
  NormalizedHealthEvidence,
} from "../../coach/ports";

/**
 * The JavaScript/native boundary for Health Connect.  It intentionally uses
 * only primitives: Android SDK record classes, permission constants and
 * ChangesToken all remain inside the Android Expo module.
 *
 * `nextCursor` is opaque.  The application commits it only alongside the
 * normalized Timeline mutations, so a native read must never persist it.
 */
export interface AndroidHealthConnectNativeModule {
  getAvailabilityAsync(): Promise<AndroidHealthConnectAvailability>;
  getPermissionStateAsync(metricTypes: readonly string[]): Promise<Readonly<Record<string, AndroidHealthPermission>>>;
  requestPermissionsAsync?(metricTypes: readonly string[]): Promise<Readonly<Record<string, AndroidHealthPermission>>>;
  readEvidencePageAsync(metricTypes: readonly string[], cursor?: string): Promise<AndroidHealthConnectNativePage>;
}

export type AndroidHealthConnectAvailability =
  | "available"
  | "not_supported"
  | "provider_missing_or_update_required"
  | "temporarily_unavailable";

export type AndroidHealthPermission = "granted" | "denied" | "not_requested" | "not_supported";

/** The only Health Connect records requested by the Android MVP. */
export const ANDROID_HEALTH_CONNECT_MVP_METRICS = [
  "sleep",
  "hrv_rmssd",
  "resting_heart_rate",
  "activity",
  "body_weight",
  "body_fat_percentage",
] as const satisfies readonly HealthMetric[];

export interface AndroidHealthConnectNativePage {
  /** The token must only be advanced by CoachApplication after an AtomicCommit. */
  nextCursor?: string;
  evidence: readonly AndroidHealthConnectNativeEvidence[];
  /** A changes token may have expired; native must fall back to a bounded resync. */
  cursorReset?: boolean;
  /** A bounded page remains; callers may resume through the same local import path. */
  hasMore?: boolean;
  /** The adapter is still walking its bounded initial-history window. */
  initialSyncPending?: boolean;
}

/** Raw, SDK-free representation returned by the Android module. */
export interface AndroidHealthConnectNativeEvidence {
  id: string;
  metric: string;
  value?: number;
  unit?: string;
  /** Omitted for a deletion-only Changes API event. */
  occurredAt?: string;
  /** Local time when native observed this change; not the record occurrence. */
  observedAt?: string;
  endedAt?: string;
  timezoneOffsetMinutes?: number;
  dataOriginPackage?: string;
  deviceId?: string;
  deviceManufacturer?: string;
  deviceModel?: string;
  deviceType?: string;
  recordingMethod?: string;
  clientRecordId?: string;
  clientRecordVersion?: string;
  lastModifiedAt?: string;
  /** Health Connect deletion notifications intentionally contain only record id. */
  change?: "upsert" | "delete";
}

export interface HealthFreshnessPolicy {
  readonly version: string;
  maxAgeMs(metric: HealthMetric): number;
}

/** Product freshness only; it never labels someone recovered, ready, or unsafe. */
export const defaultHealthFreshnessPolicy: HealthFreshnessPolicy = {
  version: "health-freshness-v1",
  maxAgeMs(metric) {
    switch (metric) {
      case "sleep":
      case "hrv_rmssd":
      case "hrv_sdnn":
      case "resting_heart_rate":
        return 36 * 60 * 60 * 1_000;
      case "activity":
        return 48 * 60 * 60 * 1_000;
      case "body_weight":
      case "body_fat_percentage":
        return 14 * 24 * 60 * 60 * 1_000;
    }
  },
};

export interface AndroidHealthConnectPortOptions {
  now?: () => Date;
  freshnessPolicy?: HealthFreshnessPolicy;
}

export interface AndroidHealthConnectPort extends HealthDataPort {
  readonly platform: "health_connect";
  getAvailability(): Promise<HealthAdapterAvailability>;
  getPermissionState(metricTypes: readonly HealthMetric[]): Promise<HealthEvidencePage["permissionByMetric"]>;
  /** UI calls this only after its feature-specific rationale was accepted. */
  requestPlatformPermissions(metricTypes: readonly HealthMetric[]): Promise<HealthEvidencePage["permissionByMetric"]>;
}

/**
 * Normalizes a native Health Connect module into the shared local-first port.
 * It is deliberately injectable: Node contract tests exercise this logic with
 * a fake module, while Android is merely one producer of raw evidence.
 */
export function createAndroidHealthConnectPort(
  native: AndroidHealthConnectNativeModule,
  options: AndroidHealthConnectPortOptions = {},
): AndroidHealthConnectPort {
  const now = options.now ?? (() => new Date());
  const freshnessPolicy = options.freshnessPolicy ?? defaultHealthFreshnessPolicy;

  const permissionState = async (metricTypes: readonly HealthMetric[]) => {
    const supported = metricTypes.filter(supportsAndroidHealthMetric);
    const raw = supported.length ? await native.getPermissionStateAsync(supported) : {};
    return normalizePermissionByMetric(raw, metricTypes);
  };

  return {
    platform: "health_connect",
    async getAvailability() {
      try {
        return normalizeAvailability(await native.getAvailabilityAsync());
      } catch {
        return "query_error";
      }
    },
    async getPermissionState(metricTypes) {
      try {
        return await permissionState(metricTypes);
      } catch {
        return emptyPermissions(metricTypes, "missing");
      }
    },
    async requestPlatformPermissions(metricTypes) {
      if (!native.requestPermissionsAsync) throw new Error("health_connect_permission_request_unavailable");
      const supported = metricTypes.filter(supportsAndroidHealthMetric);
      const raw = supported.length ? await native.requestPermissionsAsync(supported) : {};
      return normalizePermissionByMetric(raw, metricTypes);
    },
    async getConnectionState(input): Promise<HealthConnectionState> {
      const availability = await this.getAvailability();
      if (availability !== "available") return unavailableConnection(input.metricTypes, availability);
      const permissionByMetric = await this.getPermissionState(input.metricTypes);
      return {
        availability: connectionAvailability(permissionByMetric, input.metricTypes),
        permissionByMetric,
        capabilityByMetric: capabilityByMetric(input.metricTypes),
      };
    },
    async requestPermissions(input): Promise<HealthConnectionState> {
      const availability = await this.getAvailability();
      if (availability !== "available") return unavailableConnection(input.metricTypes, availability);
      const permissionByMetric = await this.requestPlatformPermissions(input.metricTypes);
      return {
        availability: connectionAvailability(permissionByMetric, input.metricTypes),
        permissionByMetric,
        capabilityByMetric: capabilityByMetric(input.metricTypes),
      };
    },
    // Health evidence paging is the authoritative import surface. The older
    // FactRef method remains for pre-HealthEvidencePage callers and must not
    // create non-provenanced health facts.
    async readFacts(_userId: string, _since: string): Promise<readonly FactRef[]> {
      return [];
    },
    async readEvidencePage(input: HealthEvidencePageRequest): Promise<HealthEvidencePage> {
      let availability: HealthAdapterAvailability;
      try {
        availability = normalizeAvailability(await native.getAvailabilityAsync());
      } catch {
        return unavailablePage(input.metricTypes, "query_error");
      }
      if (availability !== "available") return unavailablePage(input.metricTypes, availability);

      let permissionByMetric: HealthEvidencePage["permissionByMetric"];
      try {
        permissionByMetric = await permissionState(input.metricTypes);
      } catch {
        return unavailablePage(input.metricTypes, "query_error");
      }
      const granted = input.metricTypes.filter((metric) => permissionByMetric[metric] === "granted");
      if (!granted.length) {
        return {
          availability: hasPermissionDenied(permissionByMetric, input.metricTypes)
            ? "permission_denied_or_revoked"
            : "permission_not_requested",
          evidence: [],
          permissionByMetric,
          capabilityByMetric: capabilityByMetric(input.metricTypes),
        };
      }
      try {
        const page = await native.readEvidencePageAsync(granted, input.cursor);
        return {
          availability: "available",
          evidence: page.evidence.flatMap((item) => normalizeEvidence(item, granted, permissionByMetric, now(), freshnessPolicy)),
          ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
          ...(page.cursorReset ? { cursorReset: true } : {}),
          ...(page.hasMore ? { hasMore: true } : {}),
          ...(page.initialSyncPending ? { initialSyncPending: true } : {}),
          permissionByMetric,
          capabilityByMetric: capabilityByMetric(input.metricTypes),
        };
      } catch {
        // Do not use an empty successful page for a failed provider query: the
        // application retains its last committed cursor and facts.
        return {
          availability: "query_error",
          evidence: [],
          permissionByMetric,
          capabilityByMetric: capabilityByMetric(input.metricTypes),
        };
      }
    },
  };
}

/** Returns undefined off Android or when a development client lacks the module. */
export function tryCreateExpoAndroidHealthConnectPort(): AndroidHealthConnectPort | undefined {
  // `require` is intentionally local: node/test and iOS never load an Android
  // native module, and the composition root can retain manual check-ins.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Platform } = require("react-native") as { Platform: { OS: string } };
    if (Platform.OS !== "android") return undefined;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { requireNativeModule } = require("expo") as {
      requireNativeModule: <T>(name: string) => T;
    };
    return createAndroidHealthConnectPort(requireNativeModule<AndroidHealthConnectNativeModule>("MaxPowerHealthConnect"));
  } catch {
    return undefined;
  }
}

function normalizeAvailability(value: AndroidHealthConnectAvailability): HealthAdapterAvailability {
  switch (value) {
    case "available":
    case "not_supported":
    case "provider_missing_or_update_required":
    case "temporarily_unavailable":
      return value;
  }
  return "query_error";
}

function normalizePermissionByMetric(
  values: Readonly<Record<string, AndroidHealthPermission>>,
  metricTypes: readonly HealthMetric[],
): HealthEvidencePage["permissionByMetric"] {
  return Object.fromEntries(metricTypes.map((metric) => [
    metric,
    supportsAndroidHealthMetric(metric) ? normalizePermission(values[metric]) : "not_supported",
  ])) as HealthEvidencePage["permissionByMetric"];
}

function normalizePermission(value: AndroidHealthPermission | undefined): HealthImportPermission {
  switch (value) {
    case "granted": return "granted";
    case "denied": return "denied";
    case "not_supported": return "not_supported";
    case "not_requested":
    default: return "missing";
  }
}

function emptyPermissions(metricTypes: readonly HealthMetric[], permission: HealthImportPermission) {
  return Object.fromEntries(metricTypes.map((metric) => [metric, permission])) as HealthEvidencePage["permissionByMetric"];
}

function capabilityByMetric(metricTypes: readonly HealthMetric[]) {
  return Object.fromEntries(metricTypes.map((metric) => [metric, supportsAndroidHealthMetric(metric) ? "supported" : "not_supported"]));
}

function unavailablePage(metricTypes: readonly HealthMetric[], availability: HealthAdapterAvailability): HealthEvidencePage {
  return {
    availability,
    evidence: [],
    permissionByMetric: emptyPermissions(metricTypes, availability === "not_supported" ? "not_supported" : "missing"),
    capabilityByMetric: Object.fromEntries(metricTypes.map((metric) => [metric, availability === "not_supported" || !supportsAndroidHealthMetric(metric) ? "not_supported" : "supported"])),
  };
}

function unavailableConnection(metricTypes: readonly HealthMetric[], availability: HealthAdapterAvailability): HealthConnectionState {
  const page = unavailablePage(metricTypes, availability);
  return {
    availability: page.availability,
    permissionByMetric: page.permissionByMetric,
    capabilityByMetric: page.capabilityByMetric,
  };
}

function connectionAvailability(
  permissions: HealthEvidencePage["permissionByMetric"],
  metricTypes: readonly HealthMetric[],
): HealthAdapterAvailability {
  if (metricTypes.some((metric) => permissions[metric] === "granted")) return "available";
  return hasPermissionDenied(permissions, metricTypes) ? "permission_denied_or_revoked" : "permission_not_requested";
}

function hasPermissionDenied(
  permissions: HealthEvidencePage["permissionByMetric"],
  metricTypes: readonly HealthMetric[],
): boolean {
  return metricTypes.some((metric) => permissions[metric] === "denied");
}

function normalizeEvidence(
  item: AndroidHealthConnectNativeEvidence,
  granted: readonly HealthMetric[],
  permissionByMetric: HealthEvidencePage["permissionByMetric"],
  now: Date,
  freshnessPolicy: HealthFreshnessPolicy,
): readonly NormalizedHealthEvidence[] {
  if (!isHealthMetric(item.metric) || !granted.includes(item.metric) || permissionByMetric[item.metric] !== "granted") return [];
  const deleted = item.change === "delete";
  const observedAt = item.observedAt ?? now.toISOString();
  if (!item.id || !validIso(observedAt)) return [];
  if (!deleted && (!item.occurredAt || !validIso(item.occurredAt))) return [];
  if (item.endedAt !== undefined && !validIso(item.endedAt)) return [];
  const metric = item.metric;
  if (!deleted && !validMetricValue(metric, item.value, item.unit)) return [];
  const occurred = new Date(item.endedAt ?? item.occurredAt ?? observedAt);
  const freshness = deleted ? "fresh" as const : classifyFreshness(now, occurred, freshnessPolicy.maxAgeMs(metric));
  return [{
    id: item.id,
    metric,
    ...(item.value !== undefined ? { value: item.value } : {}),
    ...(unitFor(metric, item.unit) ? { unit: unitFor(metric, item.unit) } : {}),
    ...(item.occurredAt ? { occurredAt: item.occurredAt } : {}),
    ...(item.observedAt ? { observedAt: item.observedAt } : {}),
    ...(item.endedAt ? { endedAt: item.endedAt } : {}),
    timezoneOffsetMinutes: item.timezoneOffsetMinutes ?? 0,
    origin: "health_connect",
    ...(item.deviceId ? { deviceId: item.deviceId } : {}),
    ...(item.dataOriginPackage ? { sourceAppId: item.dataOriginPackage } : {}),
    ...(item.clientRecordId ? { clientRecordId: item.clientRecordId } : {}),
    ...(item.clientRecordVersion ? { clientRecordVersion: item.clientRecordVersion } : {}),
    ...(item.deviceManufacturer ? { deviceManufacturer: item.deviceManufacturer } : {}),
    ...(item.deviceModel ? { deviceModel: item.deviceModel } : {}),
    ...(item.deviceType ? { deviceType: item.deviceType } : {}),
    ...(item.recordingMethod ? { sourceRecordingMethod: item.recordingMethod } : {}),
    recordingMethod: "platform_import",
    ...(item.clientRecordVersion ? { sourceRevision: item.clientRecordVersion } : {}),
    ...(item.lastModifiedAt ? { lastModifiedAt: item.lastModifiedAt } : {}),
    ...(deleted ? { change: "delete" as const } : {}),
    permission: "granted",
    freshness,
    sourceRecordId: item.id,
  }];
}

function isHealthMetric(value: string): value is HealthMetric {
  return ["sleep", "hrv_sdnn", "hrv_rmssd", "resting_heart_rate", "activity", "body_weight", "body_fat_percentage"].includes(value);
}

function supportsAndroidHealthMetric(metric: HealthMetric): boolean {
  return metric !== "hrv_sdnn";
}

function validMetricValue(metric: HealthMetric, value: number | undefined, unit: string | undefined): boolean {
  if (value === undefined || !Number.isFinite(value) || value < 0) return false;
  switch (metric) {
    case "sleep":
    case "activity": return unit === "hours" || unit === "minutes" || unit === "seconds";
    case "hrv_sdnn":
    case "hrv_rmssd": return unit === "milliseconds";
    case "resting_heart_rate": return unit === "beats_per_minute";
    case "body_weight": return unit === "kg" || unit === "lb";
    case "body_fat_percentage": return unit === "percent" && value <= 100;
  }
}

function unitFor(metric: HealthMetric, unit: string | undefined): NormalizedHealthEvidence["unit"] | undefined {
  if (!unit || !validMetricValue(metric, 0, unit)) return undefined;
  return unit as NormalizedHealthEvidence["unit"];
}

function validIso(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

function classifyFreshness(now: Date, observed: Date, maxAgeMs: number): "fresh" | "stale" | "partial" {
  const age = now.getTime() - observed.getTime();
  if (!Number.isFinite(age) || age < -5 * 60 * 1_000) return "partial";
  return age <= maxAgeMs ? "fresh" : "stale";
}
