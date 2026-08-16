/**
 * The mobile shell deliberately has a very small internal-route registry.
 * Incoming URLs are presentation requests only: resolving one never starts a
 * workout, creates a CoachSession, applies an Artifact, or interprets model
 * output as navigation.
 */
export type ProductDeepLinkRoute =
  | "today"
  | "calendar"
  | "plan"
  | "profile"
  | "workout";

export type ProductDeepLinkIntent =
  | { route: "today" | "calendar"; date: string }
  | { route: "plan" | "profile" }
  | { route: "workout"; workoutId: string };

/** The durable-enough, fact-free portion of shell navigation state. */
export interface ProductNavigationState {
  route: ProductDeepLinkRoute;
  date: string;
  calendarMode: "week" | "month";
  coachExpanded: boolean;
  workoutId?: string;
}

/**
 * Process-restorable shell state is deliberately presentation-only. It never
 * contains a Timeline value, Plan payload, Coach message, ActionToken, or an
 * unconfirmed form value. Those belong to their respective canonical stores.
 */
export interface ProductShellState {
  navigation: ProductNavigationState;
  /** A reference to an already-persisted CoachSession, never a request to create one. */
  coachAttachment?: ProductCoachAttachment;
  /**
   * A form may persist only an immutable domain reference. Free-text and
   * unconfirmed numeric fields are intentionally discarded after a process
   * restart rather than becoming accidental facts.
   */
  unfinishedForm?: ProductUnfinishedForm;
}

export interface ProductCoachAttachment {
  sessionId: string;
  foreground: "expanded" | "minimized";
}

export type ProductUnfinishedForm =
  | {
      kind: "activity_log" | "exercise_editor";
      recovery: "discard_on_process_restore";
    }
  | {
      kind: "workout_set";
      workoutId: string;
      prescriptionSetId: string;
      recovery: "discard_on_process_restore";
    };

export type ProductShellFormRecovery =
  | { kind: "none" }
  | { kind: "discarded"; formKind: ProductUnfinishedForm["kind"] };

export interface ProductShellRecovery {
  state: ProductShellState;
  formRecovery: ProductShellFormRecovery;
}

/** Bump only with an explicit migration; unknown snapshots fail closed. */
export const PRODUCT_SHELL_STATE_SCHEMA_VERSION = 1;

interface PersistedProductShellState extends ProductShellState {
  schemaVersion: typeof PRODUCT_SHELL_STATE_SCHEMA_VERSION;
}

const maxUrlLength = 512;
const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/;
// IDs are opaque Ledger identifiers. Deliberately exclude URL separators and
// percent-encoded variants after decoding so a deep link cannot become a
// nested route or an arbitrary payload carrier.
const opaqueIdentifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export function initialProductNavigationState(date: string): ProductNavigationState {
  if (!isValidLocalDate(date)) throw new Error("Initial navigation date must be a valid local date.");
  return {
    route: "today",
    date,
    calendarMode: "week",
    coachExpanded: false,
  };
}

/** Starts a fact-free shell. The selected date remains an explicit UI choice. */
export function initialProductShellState(date: string): ProductShellState {
  return { navigation: initialProductNavigationState(date) };
}

/**
 * Makes an already-created CoachSession visible in the shell. This is only a
 * reference: the composition root must still resolve the session from the
 * application before rendering it, so a stale id cannot re-open a new run.
 */
export function attachCoachToProductShell(
  current: ProductShellState,
  attachment: ProductCoachAttachment,
): ProductShellState {
  const normalized = normalizeProductShellState(current);
  if (!normalized || !isValidCoachAttachment(attachment)) {
    throw new Error("Product Coach attachment must reference an existing, safe context.");
  }
  if (attachment.foreground === "expanded" && !routeAllowsCoach(normalized.navigation.route)) {
    throw new Error("Coach foreground is not available on this route.");
  }
  return {
    ...normalized,
    navigation: {
      ...normalized.navigation,
      coachExpanded: attachment.foreground === "expanded",
    },
    coachAttachment: cloneCoachAttachment(attachment),
  };
}

/**
 * Page changes never create/close a Coach session. A linked session becomes
 * minimized so the next permitted page can resolve the exact same reference.
 */
export function applyProductShellNavigation(
  current: ProductShellState,
  navigation: ProductNavigationState,
): ProductShellState {
  const normalizedCurrent = normalizeProductShellState(current);
  const normalizedNavigation = normalizeProductNavigationState(navigation);
  if (!normalizedCurrent || !normalizedNavigation) {
    throw new Error("Product navigation state is invalid.");
  }
  const attachment = normalizedCurrent.coachAttachment
    ? { ...normalizedCurrent.coachAttachment, foreground: "minimized" as const }
    : undefined;
  return compactProductShellState({
    navigation: { ...normalizedNavigation, coachExpanded: false },
    ...(attachment ? { coachAttachment: attachment } : {}),
    ...(normalizedCurrent.unfinishedForm ? { unfinishedForm: normalizedCurrent.unfinishedForm } : {}),
  });
}

/**
 * Registers an unfinished view at a bounded semantic level. In particular it
 * cannot persist arbitrary form text, number fields, tool payloads, or a
 * pending ActionToken as if they were domain records.
 */
export function markProductFormOpen(
  current: ProductShellState,
  form: ProductUnfinishedForm,
): ProductShellState {
  const normalized = normalizeProductShellState(current);
  if (!normalized || !isValidProductForm(form)) {
    throw new Error("Product form recovery state is invalid.");
  }
  return compactProductShellState({ ...normalized, unfinishedForm: cloneProductForm(form) });
}

export function clearProductFormRecovery(current: ProductShellState): ProductShellState {
  const normalized = normalizeProductShellState(current);
  if (!normalized) throw new Error("Product shell state is invalid.");
  return compactProductShellState({
    navigation: normalized.navigation,
    ...(normalized.coachAttachment ? { coachAttachment: normalized.coachAttachment } : {}),
  });
}

/** Produces the only supported on-disk representation of shell UI state. */
export function encodeProductShellState(state: ProductShellState): string {
  const normalized = normalizeProductShellState(state);
  if (!normalized) throw new Error("Product shell state cannot be persisted.");
  const persisted: PersistedProductShellState = {
    schemaVersion: PRODUCT_SHELL_STATE_SCHEMA_VERSION,
    ...normalized,
  };
  return JSON.stringify(persisted);
}

/**
 * Decodes only the current schema. Corrupt, future, stale, or externally
 * injected content has no routing side effect and falls back to Today.
 */
export function decodeProductShellState(value: string | undefined, fallbackDate: string): ProductShellState | undefined {
  if (!isValidLocalDate(fallbackDate) || !value || value.length > maxUrlLength * 8) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isPlainObject(parsed) || parsed.schemaVersion !== PRODUCT_SHELL_STATE_SCHEMA_VERSION) return undefined;
    const { schemaVersion: _schemaVersion, ...candidate } = parsed;
    return normalizeProductShellState(candidate);
  } catch {
    return undefined;
  }
}

/**
 * Resolves process restart semantics in one place. Ordinary incomplete forms
 * are visibly discarded. Structured nutrition entry uses the shared Record
 * Module directly, so there is no second artifact-backed form workflow to
 * recover outside the Conversation transcript.
 */
export function resolveProductShellRecovery(value: string | undefined, fallbackDate: string): ProductShellRecovery {
  const decoded = decodeProductShellState(value, fallbackDate);
  if (!decoded) return { state: initialProductShellState(fallbackDate), formRecovery: { kind: "none" } };
  const form = decoded.unfinishedForm;
  if (!form) return { state: decoded, formRecovery: { kind: "none" } };
  return {
    state: clearProductFormRecovery(decoded),
    formRecovery: { kind: "discarded", formKind: form.kind },
  };
}

/**
 * Resolves only registered internal MaxPower routes. Search and hash payloads
 * are intentionally not supported: an Artifact, pending action, or tool
 * payload is never a navigation target.
 */
export function resolveMaxPowerDeepLink(value?: string): ProductDeepLinkIntent | undefined {
  if (!value || value.length > maxUrlLength) return undefined;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (
    url.protocol !== "maxpower:" ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash
  ) {
    return undefined;
  }
  // WHATWG URL intentionally normalizes `..` path segments. Inspect the raw
  // path as well so a malformed external URL cannot normalize into a valid
  // Workout target after validation.
  if (hasUnsafeRawPathSegment(value)) return undefined;

  const route = url.hostname as ProductDeepLinkRoute;
  if (!isRegisteredRoute(route)) return undefined;

  if (route === "plan" || route === "profile") {
    return url.pathname === "" || url.pathname === "/" ? { route } : undefined;
  }

  const segment = decodeSinglePathSegment(url.pathname);
  if (!segment) return undefined;

  if (route === "workout") {
    return opaqueIdentifierPattern.test(segment) ? { route, workoutId: segment } : undefined;
  }
  return isValidLocalDate(segment) ? { route, date: segment } : undefined;
}

/**
 * Applies a validated external route as shell presentation state only. The
 * caller must read the current canonical projection after this transition;
 * a Workout route merely asks the existing WorkoutSession to be read.
 */
export function applyInboundNavigationIntent(
  current: ProductNavigationState,
  intent: ProductDeepLinkIntent,
): ProductNavigationState {
  if (intent.route === "workout") {
    return {
      ...current,
      route: "workout",
      workoutId: intent.workoutId,
      coachExpanded: false,
    };
  }
  if (intent.route === "plan" || intent.route === "profile") {
    return {
      ...current,
      route: intent.route,
      workoutId: undefined,
      coachExpanded: false,
    };
  }
  if (!("date" in intent)) {
    // Exhaustiveness guard for future registry additions. An unrecognised
    // intent must never turn into a route with an implicit date.
    return current;
  }
  return {
    ...current,
    route: intent.route,
    date: intent.date,
    workoutId: undefined,
    coachExpanded: false,
  };
}

function isRegisteredRoute(value: string): value is ProductDeepLinkRoute {
  return value === "today" || value === "calendar" || value === "plan" || value === "profile" || value === "workout";
}

function decodeSinglePathSegment(pathname: string): string | undefined {
  if (!/^\/[^/]+$/.test(pathname)) return undefined;
  try {
    const segment = decodeURIComponent(pathname.slice(1));
    return segment && !segment.includes("/") && !segment.includes("\\") ? segment : undefined;
  } catch {
    return undefined;
  }
}

function hasUnsafeRawPathSegment(value: string): boolean {
  const schemeEnd = value.indexOf("://");
  if (schemeEnd < 0) return true;
  const authorityStart = schemeEnd + 3;
  const pathStart = value.indexOf("/", authorityStart);
  if (pathStart < 0) return false;
  const pathEnd = value.slice(pathStart).search(/[?#]/);
  const rawPath = pathEnd < 0 ? value.slice(pathStart) : value.slice(pathStart, pathStart + pathEnd);
  return rawPath.split("/").some((rawSegment) => {
    if (!rawSegment) return false;
    try {
      const segment = decodeURIComponent(rawSegment);
      return segment === "." || segment === ".." || segment.includes("/") || segment.includes("\\");
    } catch {
      return true;
    }
  });
}

export function isValidLocalDate(value: string): boolean {
  const match = datePattern.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function normalizeProductShellState(value: unknown): ProductShellState | undefined {
  if (!isPlainObject(value) || !hasOnlyKeys(value, ["navigation", "coachAttachment", "unfinishedForm"])) return undefined;
  const navigation = normalizeProductNavigationState(value.navigation);
  if (!navigation) return undefined;
  const coachAttachment = value.coachAttachment === undefined ? undefined : normalizeCoachAttachment(value.coachAttachment);
  if (value.coachAttachment !== undefined && !coachAttachment) return undefined;
  const unfinishedForm = value.unfinishedForm === undefined ? undefined : normalizeProductForm(value.unfinishedForm);
  if (value.unfinishedForm !== undefined && !unfinishedForm) return undefined;
  // A foreground sheet is only meaningful when it points at a known session
  // and a route where the product intentionally exposes Coach.
  if (navigation.coachExpanded !== Boolean(coachAttachment && coachAttachment.foreground === "expanded")) return undefined;
  if (navigation.coachExpanded && !routeAllowsCoach(navigation.route)) return undefined;
  return compactProductShellState({
    navigation,
    ...(coachAttachment ? { coachAttachment } : {}),
    ...(unfinishedForm ? { unfinishedForm } : {}),
  });
}

function normalizeProductNavigationState(value: unknown): ProductNavigationState | undefined {
  if (!isPlainObject(value) || !hasOnlyKeys(value, ["route", "date", "calendarMode", "coachExpanded", "workoutId"])) return undefined;
  if (typeof value.route !== "string" || !isRegisteredRoute(value.route) || typeof value.date !== "string" || !isValidLocalDate(value.date)) return undefined;
  if (value.calendarMode !== "week" && value.calendarMode !== "month") return undefined;
  if (typeof value.coachExpanded !== "boolean") return undefined;
  if (value.route === "workout") {
    if (typeof value.workoutId !== "string" || !isOpaqueIdentifier(value.workoutId)) return undefined;
    return {
      route: value.route,
      date: value.date,
      calendarMode: value.calendarMode,
      coachExpanded: value.coachExpanded,
      workoutId: value.workoutId,
    };
  }
  if (value.workoutId !== undefined) return undefined;
  return {
    route: value.route,
    date: value.date,
    calendarMode: value.calendarMode,
    coachExpanded: value.coachExpanded,
  };
}

function normalizeCoachAttachment(value: unknown): ProductCoachAttachment | undefined {
  if (!isPlainObject(value) || !hasOnlyKeys(value, ["sessionId", "foreground"]) || typeof value.sessionId !== "string" || !isOpaqueIdentifier(value.sessionId)) return undefined;
  if (value.foreground !== "expanded" && value.foreground !== "minimized") return undefined;
  return { sessionId: value.sessionId, foreground: value.foreground };
}

function normalizeProductForm(value: unknown): ProductUnfinishedForm | undefined {
  if (!isPlainObject(value) || typeof value.kind !== "string" || typeof value.recovery !== "string") return undefined;
  if (
    (value.kind === "activity_log" || value.kind === "exercise_editor") &&
    value.recovery === "discard_on_process_restore" &&
    hasOnlyKeys(value, ["kind", "recovery"])
  ) {
    return { kind: value.kind, recovery: value.recovery };
  }
  if (
    value.kind === "workout_set" &&
    value.recovery === "discard_on_process_restore" &&
    hasOnlyKeys(value, ["kind", "workoutId", "prescriptionSetId", "recovery"]) &&
    typeof value.workoutId === "string" &&
    typeof value.prescriptionSetId === "string" &&
    isOpaqueIdentifier(value.workoutId) &&
    isOpaqueIdentifier(value.prescriptionSetId)
  ) {
    return {
      kind: "workout_set",
      workoutId: value.workoutId,
      prescriptionSetId: value.prescriptionSetId,
      recovery: "discard_on_process_restore",
    };
  }
  return undefined;
}

function compactProductShellState(state: ProductShellState): ProductShellState {
  return {
    navigation: compactProductNavigationState(state.navigation),
    ...(state.coachAttachment ? { coachAttachment: cloneCoachAttachment(state.coachAttachment) } : {}),
    ...(state.unfinishedForm ? { unfinishedForm: cloneProductForm(state.unfinishedForm) } : {}),
  };
}

function compactProductNavigationState(state: ProductNavigationState): ProductNavigationState {
  return {
    route: state.route,
    date: state.date,
    calendarMode: state.calendarMode,
    coachExpanded: state.coachExpanded,
    ...(state.workoutId ? { workoutId: state.workoutId } : {}),
  };
}

function cloneCoachAttachment(value: ProductCoachAttachment): ProductCoachAttachment {
  return { sessionId: value.sessionId, foreground: value.foreground };
}

function cloneProductForm(value: ProductUnfinishedForm): ProductUnfinishedForm {
  if (value.kind === "workout_set") return { ...value };
  return { kind: value.kind, recovery: value.recovery };
}

function isValidCoachAttachment(value: ProductCoachAttachment): boolean {
  return normalizeCoachAttachment(value) !== undefined;
}

function isValidProductForm(value: ProductUnfinishedForm): boolean {
  return normalizeProductForm(value) !== undefined;
}

function isOpaqueIdentifier(value: string): boolean {
  return opaqueIdentifierPattern.test(value);
}

function routeAllowsCoach(route: ProductDeepLinkRoute): boolean {
  return route === "today" || route === "calendar" || route === "plan" || route === "workout";
}


function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}
