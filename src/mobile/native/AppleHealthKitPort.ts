import type { FactRef, HealthAdapterAvailability, HealthImportPermission, HealthMetric } from "../../coach/model";
import type {
  HealthConnectionState,
  HealthDataPort,
  HealthEvidencePage,
  HealthEvidencePageRequest,
  NormalizedHealthEvidence,
} from "../../coach/ports";

/** The only HealthKit records requested by the iOS MVP. */
export const APPLE_HEALTHKIT_MVP_METRICS = [
  "sleep",
  "hrv_sdnn",
  "resting_heart_rate",
  "activity",
  "body_weight",
  "body_fat_percentage",
] as const satisfies readonly HealthMetric[];

/**
 * Swift stays the sole owner of HealthKit types. This boundary deliberately
 * exposes only primitive values, opaque anchors and a privacy-safe request
 * state; it never attempts to reveal Apple read authorization.
 */
export interface AppleHealthKitNativeModule {
  getAvailabilityAsync(): Promise<AppleHealthKitAvailability>;
  getPermissionStateAsync(metricTypes: readonly string[]): Promise<Readonly<Record<string, AppleHealthKitPermission>>>;
  requestPermissionsAsync?(metricTypes: readonly string[]): Promise<Readonly<Record<string, AppleHealthKitPermission>>>;
  readEvidencePageAsync(metricTypes: readonly string[], cursor?: string): Promise<AppleHealthKitNativePage>;
}

export type AppleHealthKitAvailability = "available" | "not_supported" | "temporarily_unavailable";
/** `requested` only says MaxPower requested a read type; it is not a grant. */
export type AppleHealthKitPermission = "requested" | "not_requested" | "not_supported";

export interface AppleHealthKitNativePage {
  nextCursor?: string;
  evidence: readonly AppleHealthKitNativeEvidence[];
  cursorReset?: boolean;
  hasMore?: boolean;
  initialSyncPending?: boolean;
}

export interface AppleHealthKitNativeEvidence {
  id: string;
  metric: string;
  value?: number;
  unit?: string;
  occurredAt?: string;
  observedAt?: string;
  endedAt?: string;
  timezoneOffsetMinutes?: number;
  sourceBundleId?: string;
  sourceVersion?: string;
  deviceId?: string;
  deviceManufacturer?: string;
  deviceModel?: string;
  deviceType?: string;
  recordingMethod?: string;
  clientRecordId?: string;
  clientRecordVersion?: string;
  lastModifiedAt?: string;
  change?: "upsert" | "delete";
  measurementMethod?: string;
}

export interface AppleHealthKitPortOptions {
  now?: () => Date;
  maxAgeMs?: (metric: HealthMetric) => number;
}

export interface AppleHealthKitPort extends HealthDataPort {
  readonly platform: "healthkit";
  getAvailability(): Promise<HealthAdapterAvailability>;
  getPermissionState(metricTypes: readonly HealthMetric[]): Promise<HealthEvidencePage["permissionByMetric"]>;
  requestPlatformPermissions(metricTypes: readonly HealthMetric[]): Promise<HealthEvidencePage["permissionByMetric"]>;
}

/**
 * Maps the native HealthKit bridge onto the common local-first HealthDataPort.
 * An `unknown` permission is intentional: Apple states that read access cannot
 * be inspected. The adapter can query after a user request, but an empty page
 * means only "no readable samples", never "denied" or "healthy".
 */
export function createAppleHealthKitPort(
  native: AppleHealthKitNativeModule,
  options: AppleHealthKitPortOptions = {},
): AppleHealthKitPort {
  const now = options.now ?? (() => new Date());
  const maxAgeMs = options.maxAgeMs ?? defaultMaxAgeMs;
  const permissions = async (metrics: readonly HealthMetric[]) => {
    const supported = metrics.filter(supportsAppleHealthMetric);
    const values = supported.length ? await native.getPermissionStateAsync(supported) : {};
    return normalizePermissions(values, metrics);
  };

  return {
    platform: "healthkit",
    async getAvailability() {
      try { return normalizeAvailability(await native.getAvailabilityAsync()); } catch { return "query_error"; }
    },
    async getPermissionState(metricTypes) {
      try { return await permissions(metricTypes); } catch { return emptyPermissions(metricTypes, "missing"); }
    },
    async requestPlatformPermissions(metricTypes) {
      if (!native.requestPermissionsAsync) throw new Error("healthkit_permission_request_unavailable");
      const supported = metricTypes.filter(supportsAppleHealthMetric);
      const values = supported.length ? await native.requestPermissionsAsync(supported) : {};
      return normalizePermissions(values, metricTypes);
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
    async readFacts(_userId: string, _since: string): Promise<readonly FactRef[]> { return []; },
    async readEvidencePage(input: HealthEvidencePageRequest): Promise<HealthEvidencePage> {
      let availability: HealthAdapterAvailability;
      try { availability = normalizeAvailability(await native.getAvailabilityAsync()); } catch { return unavailablePage(input.metricTypes, "query_error"); }
      if (availability !== "available") return unavailablePage(input.metricTypes, availability);
      let permissionByMetric: HealthEvidencePage["permissionByMetric"];
      try { permissionByMetric = await permissions(input.metricTypes); } catch { return unavailablePage(input.metricTypes, "query_error"); }
      const requested = input.metricTypes.filter((metric) => permissionByMetric[metric] === "unknown" || permissionByMetric[metric] === "granted");
      if (!requested.length) {
        return {
          availability: "permission_not_requested",
          evidence: [],
          permissionByMetric,
          capabilityByMetric: capabilityByMetric(input.metricTypes),
        };
      }
      try {
        const page = await native.readEvidencePageAsync(requested, input.cursor);
        return {
          availability: "available",
          evidence: page.evidence.flatMap((item) => normalizeEvidence(item, requested, permissionByMetric, now(), maxAgeMs)),
          ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
          ...(page.cursorReset ? { cursorReset: true } : {}),
          ...(page.hasMore ? { hasMore: true } : {}),
          ...(page.initialSyncPending ? { initialSyncPending: true } : {}),
          permissionByMetric,
          capabilityByMetric: capabilityByMetric(input.metricTypes),
        };
      } catch {
        return { availability: "query_error", evidence: [], permissionByMetric, capabilityByMetric: capabilityByMetric(input.metricTypes) };
      }
    },
  };
}

/** Returns undefined off iOS or when a development client lacks the native module. */
export function tryCreateExpoAppleHealthKitPort(): AppleHealthKitPort | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Platform } = require("react-native") as { Platform: { OS: string } };
    if (Platform.OS !== "ios") return undefined;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { requireNativeModule } = require("expo") as { requireNativeModule: <T>(name: string) => T };
    return createAppleHealthKitPort(requireNativeModule<AppleHealthKitNativeModule>("MaxPowerHealthKit"));
  } catch {
    return undefined;
  }
}

function normalizeAvailability(value: AppleHealthKitAvailability): HealthAdapterAvailability {
  return value === "available" || value === "not_supported" || value === "temporarily_unavailable" ? value : "query_error";
}

function normalizePermissions(values: Readonly<Record<string, AppleHealthKitPermission>>, metrics: readonly HealthMetric[]) {
  return Object.fromEntries(metrics.map((metric) => [
    metric,
    supportsAppleHealthMetric(metric) ? normalizePermission(values[metric]) : "not_supported",
  ])) as HealthEvidencePage["permissionByMetric"];
}

function normalizePermission(value: AppleHealthKitPermission | undefined): HealthImportPermission {
  if (value === "requested") return "unknown";
  if (value === "not_supported") return "not_supported";
  return "missing";
}

function emptyPermissions(metrics: readonly HealthMetric[], value: HealthImportPermission) {
  return Object.fromEntries(metrics.map((metric) => [metric, value])) as HealthEvidencePage["permissionByMetric"];
}

function capabilityByMetric(metrics: readonly HealthMetric[]) {
  return Object.fromEntries(metrics.map((metric) => [metric, supportsAppleHealthMetric(metric) ? "supported" : "not_supported"]));
}

function unavailablePage(metrics: readonly HealthMetric[], availability: HealthAdapterAvailability): HealthEvidencePage {
  return {
    availability,
    evidence: [],
    permissionByMetric: emptyPermissions(metrics, availability === "not_supported" ? "not_supported" : "missing"),
    capabilityByMetric: Object.fromEntries(metrics.map((metric) => [metric, availability === "not_supported" || !supportsAppleHealthMetric(metric) ? "not_supported" : "supported"])),
  };
}

function unavailableConnection(metrics: readonly HealthMetric[], availability: HealthAdapterAvailability): HealthConnectionState {
  const page = unavailablePage(metrics, availability);
  return { availability: page.availability, permissionByMetric: page.permissionByMetric, capabilityByMetric: page.capabilityByMetric };
}

function connectionAvailability(permissions: HealthEvidencePage["permissionByMetric"], metrics: readonly HealthMetric[]): HealthAdapterAvailability {
  return metrics.some((metric) => permissions[metric] === "unknown" || permissions[metric] === "granted")
    ? "available"
    : "permission_not_requested";
}

function normalizeEvidence(
  item: AppleHealthKitNativeEvidence,
  requested: readonly HealthMetric[],
  permissionByMetric: HealthEvidencePage["permissionByMetric"],
  now: Date,
  maxAgeMs: (metric: HealthMetric) => number,
): readonly NormalizedHealthEvidence[] {
  if (!isMetric(item.metric) || !requested.includes(item.metric)) return [];
  const metric = item.metric;
  const permission = permissionByMetric[metric];
  if (permission !== "unknown" && permission !== "granted") return [];
  const deleted = item.change === "delete";
  const observedAt = item.observedAt ?? now.toISOString();
  if (!item.id || !validIso(observedAt) || (!deleted && (!item.occurredAt || !validIso(item.occurredAt)))) return [];
  if (item.endedAt !== undefined && !validIso(item.endedAt)) return [];
  if (!deleted && !validValue(metric, item.value, item.unit)) return [];
  const point = new Date(item.endedAt ?? item.occurredAt ?? observedAt);
  return [{
    id: item.id,
    metric,
    ...(item.value !== undefined ? { value: item.value } : {}),
    ...(unitFor(metric) ? { unit: unitFor(metric) } : {}),
    ...(item.occurredAt ? { occurredAt: item.occurredAt } : {}),
    ...(item.observedAt ? { observedAt: item.observedAt } : {}),
    ...(item.endedAt ? { endedAt: item.endedAt } : {}),
    timezoneOffsetMinutes: item.timezoneOffsetMinutes ?? 0,
    origin: "healthkit",
    ...(item.deviceId ? { deviceId: item.deviceId } : {}),
    ...(item.sourceBundleId ? { sourceAppId: item.sourceBundleId } : {}),
    ...(item.clientRecordId ? { clientRecordId: item.clientRecordId } : {}),
    ...(item.clientRecordVersion ? { clientRecordVersion: item.clientRecordVersion } : {}),
    ...(item.deviceManufacturer ? { deviceManufacturer: item.deviceManufacturer } : {}),
    ...(item.deviceModel ? { deviceModel: item.deviceModel } : {}),
    ...(item.deviceType ? { deviceType: item.deviceType } : {}),
    ...(item.recordingMethod ? { sourceRecordingMethod: item.recordingMethod } : {}),
    ...(item.measurementMethod ? { measurementMethod: item.measurementMethod } : {}),
    recordingMethod: "platform_import",
    ...(item.sourceVersion ? { sourceRevision: item.sourceVersion } : {}),
    ...(item.lastModifiedAt ? { lastModifiedAt: item.lastModifiedAt } : {}),
    ...(deleted ? { change: "delete" as const } : {}),
    permission,
    freshness: deleted ? "fresh" : now.getTime() - point.getTime() <= maxAgeMs(metric) ? "fresh" : "stale",
    sourceRecordId: item.id,
  }];
}

function isMetric(value: string): value is HealthMetric {
  return ["sleep", "hrv_sdnn", "hrv_rmssd", "resting_heart_rate", "activity", "body_weight", "body_fat_percentage"].includes(value);
}

function supportsAppleHealthMetric(metric: HealthMetric): boolean {
  return metric !== "hrv_rmssd";
}

function validIso(value: string): boolean { return Number.isFinite(Date.parse(value)); }
function validValue(metric: HealthMetric, value: number | undefined, unit: string | undefined): boolean {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return false;
  return unit === unitFor(metric);
}
function unitFor(metric: HealthMetric): NormalizedHealthEvidence["unit"] {
  switch (metric) {
    case "sleep": case "activity": return "minutes";
    case "hrv_sdnn": case "hrv_rmssd": return "milliseconds";
    case "resting_heart_rate": return "beats_per_minute";
    case "body_weight": return "kg";
    case "body_fat_percentage": return "percent";
  }
}
function defaultMaxAgeMs(metric: HealthMetric): number {
  if (metric === "sleep" || metric === "hrv_sdnn" || metric === "hrv_rmssd" || metric === "resting_heart_rate") return 36 * 60 * 60 * 1_000;
  if (metric === "activity") return 48 * 60 * 60 * 1_000;
  return 14 * 24 * 60 * 60 * 1_000;
}
