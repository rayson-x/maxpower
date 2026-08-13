import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { gunzip } from "node:zlib";

import {
  computeRustExerciseProfileHash,
  type RustEquipmentObservation,
  type RustExerciseProfileData,
} from "../../src/motion/rustCanonicalWasm";
import type { PoseCandidateEstimate } from "../../src/pose/PoseEngine";

const gunzipAsync = promisify(gunzip);

export type GovernanceInputRole =
  | "humanRanges"
  | "rawHalpe26"
  | "benchBarbellAxis"
  | "profileArtifact"
  | "blindPlan"
  | "rustWasm"
  | "sourceIndependentBenchProfile"
  | "fullDataRun";

type GovernanceAssetRole =
  | "raw_evidence"
  | "human_supervision"
  | "official_weak_supervision"
  | "model_observation"
  | "annotation_proposal"
  | "evaluation_artifact"
  | "historical_baseline"
  | "protected_runtime";

interface GovernanceAssetLocation {
  readonly root: "maxpower_source" | "power_workspace";
  readonly path: string;
  readonly kind: "file" | "directory";
  readonly sha256?: string;
  readonly selector?: string;
}

interface GovernanceAssetBinding {
  readonly assetId: string;
  readonly role: GovernanceAssetRole;
  readonly admission: string;
  readonly authority: string;
  readonly groupKey: string;
  readonly location: GovernanceAssetLocation;
  readonly definitionSha256: string;
  readonly catalogSha256: string | null;
  readonly resolvedLocationPath: string;
}

export interface MotionQualityInputCatalog {
  readonly schemaVersion: "maxpower-motion-quality-input-catalog/v2";
  readonly catalogId: string;
  readonly authorityCatalog: Readonly<{
    catalogId: string;
    path: string;
    sha256: string;
    selfAssetId: string;
  }>;
  readonly assets: Readonly<Record<GovernanceInputRole, GovernanceAssetBinding>>;
}

export interface InputAssetPin {
  readonly authorityCatalogId: string;
  readonly authorityCatalogSha256: string;
  readonly assetId: string;
  readonly role: GovernanceAssetRole;
  readonly admission: string;
  readonly authority: string;
  readonly groupKey: string;
  readonly location: GovernanceAssetLocation;
  readonly definitionSha256: string;
  readonly catalogSha256: string | null;
  readonly path: string;
  readonly sha256: string;
  readonly sourceCaptureId?: string;
}

interface SerializedMotionQualityInputCatalog {
  readonly schemaVersion: "maxpower-motion-quality-input-catalog/v2";
  readonly catalogId: string;
  readonly authorityCatalog: Readonly<{
    path: string;
    catalogId: string;
    selfAssetId: string;
  }>;
  readonly assets: Readonly<Record<GovernanceInputRole, Readonly<{
    assetId: string;
    definitionSha256: string;
  }>>>;
}

interface AuthorityAsset {
  readonly id: string;
  readonly role: GovernanceAssetRole;
  readonly admission: string;
  readonly authority: string;
  readonly location: GovernanceAssetLocation;
  readonly allowedTasks: readonly string[];
  readonly allowedSupervision: readonly string[];
  readonly forbiddenUses: readonly string[];
  readonly groupKey: string;
}

interface AuthorityAssetCatalog {
  readonly schemaVersion: "maxpower-data-asset-catalog/v1";
  readonly catalogId: string;
  readonly defaultRoots: Readonly<Record<GovernanceAssetLocation["root"], string>>;
  readonly assets: readonly AuthorityAsset[];
}

export interface RawObservationLandmark {
  readonly x: number | null;
  readonly y: number | null;
  readonly z: number | null;
  readonly visibility: number | null;
}

export interface RawObservationFrame {
  readonly frameNumber: number;
  readonly timestampMs: number;
  readonly selectedBbox: Readonly<{
    x: number;
    y: number;
    width: number;
    height: number;
  }> | null;
  readonly landmarks: readonly RawObservationLandmark[];
}

export interface RawObservationSidecar {
  readonly schemaVersion: "maxpower-raw-pose-observation-sidecar/v2";
  readonly captureId: string;
  readonly poseSchema: "halpe26";
  readonly coordinateSpace: "image_normalized";
  readonly source: Readonly<{
    video: string;
    sha256: string;
    widthPx: number;
    heightPx: number;
    durationMs: number;
  }>;
  readonly inference: Readonly<{ pipeline: string }>;
  readonly frames: readonly RawObservationFrame[];
}

export interface MeasuredBarbellAxis {
  readonly source: "measured";
  readonly confidence: number;
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly centerY: number;
}

export interface BenchEquipmentFrame {
  readonly frameNumber: number;
  readonly timestampMs: number;
  readonly axis: MeasuredBarbellAxis | Readonly<{ source: string }> | null;
}

export interface BenchEquipmentSidecar {
  readonly schemaVersion: "maxpower-barbell-pose-alignment-prototype/v1";
  readonly captureId: string;
  readonly frames: readonly BenchEquipmentFrame[];
}

export interface LoadedPinned<T> {
  readonly value: T;
  readonly bytes: Buffer;
  readonly pin: InputAssetPin;
}

export interface SourceIndependentBenchProfileEntry {
  readonly exerciseId: "barbell_bench_press";
  readonly capturePosition: "front" | "frontLeft45" | "frontRight45";
  readonly profile: RustExerciseProfileData;
}

interface SerializedSourceIndependentBenchProfiles {
  readonly schemaVersion: "maxpower-source-independent-bench-profiles/v1";
  readonly evidence: Readonly<{
    source: "builtin_source_independent_provisional";
    fittedSourceIds: readonly [];
    fittedDerivativeSourceIds: readonly [];
  }>;
  readonly profiles: readonly Readonly<{
    exerciseId: "barbell_bench_press";
    capturePosition: "front" | "frontLeft45" | "frontRight45";
    profile: Omit<RustExerciseProfileData, "contentHash">;
  }>[];
}

const GOVERNANCE_INPUT_ROLES: readonly GovernanceInputRole[] = Object.freeze([
  "humanRanges", "rawHalpe26", "benchBarbellAxis", "profileArtifact",
  "blindPlan", "rustWasm", "sourceIndependentBenchProfile", "fullDataRun",
]);

const ROLE_POLICIES: Readonly<Record<GovernanceInputRole, Readonly<{
  assetId: string;
  role: GovernanceAssetRole;
  admission: string;
  groupKey: string;
}>>> = Object.freeze({
  humanRanges: Object.freeze({
    assetId: "personal-human-rep-ranges-v2",
    role: "human_supervision",
    admission: "label_allowed",
    groupKey: "sourceCaptureId",
  }),
  rawHalpe26: Object.freeze({
    assetId: "personal-native-rtmpose-halpe26-observations",
    role: "model_observation",
    admission: "feature_only",
    groupKey: "sourceCaptureId",
  }),
  benchBarbellAxis: Object.freeze({
    assetId: "barbell-geometry-alignment-prototype",
    role: "annotation_proposal",
    admission: "proposal_only",
    groupKey: "sourceCaptureId",
  }),
  profileArtifact: Object.freeze({
    assetId: "client-cycle-aligned-profile-artifact",
    role: "evaluation_artifact",
    admission: "evaluation_only",
    groupKey: "sourceCaptureId",
  }),
  blindPlan: Object.freeze({
    assetId: "motion-quality-review-evaluation-artifacts",
    role: "evaluation_artifact",
    admission: "evaluation_only",
    groupKey: "sourceCaptureId",
  }),
  rustWasm: Object.freeze({
    assetId: "maxpower-motion-sdk-wasm",
    role: "protected_runtime",
    admission: "protected",
    groupKey: "not_applicable",
  }),
  sourceIndependentBenchProfile: Object.freeze({
    assetId: "source-independent-bench-profile-config",
    role: "evaluation_artifact",
    admission: "evaluation_only",
    groupKey: "not_applicable",
  }),
  fullDataRun: Object.freeze({
    assetId: "motion-quality-review-evaluation-artifacts",
    role: "evaluation_artifact",
    admission: "evaluation_only",
    groupKey: "sourceCaptureId",
  }),
});

export async function loadInputCatalog(path: string): Promise<LoadedPinned<MotionQualityInputCatalog>> {
  const absolute = resolve(path);
  const bytes = await readFile(absolute);
  const serialized = JSON.parse(bytes.toString("utf8")) as SerializedMotionQualityInputCatalog;
  if (serialized.schemaVersion !== "maxpower-motion-quality-input-catalog/v2") {
    throw new Error("motion-quality input catalog schema is unsupported");
  }
  if (!serialized.catalogId || !serialized.authorityCatalog?.path
      || !serialized.authorityCatalog.catalogId || !serialized.authorityCatalog.selfAssetId) {
    throw new Error("motion-quality input catalog authority declaration is incomplete");
  }
  const declaredRoles = Object.keys(serialized.assets ?? {}).sort();
  if (declaredRoles.join(",") !== [...GOVERNANCE_INPUT_ROLES].sort().join(",")) {
    throw new Error("motion-quality input catalog roles drifted from the runtime contract");
  }

  const authorityAbsolute = resolve(dirname(absolute), serialized.authorityCatalog.path);
  const canonicalAuthorityAbsolute = resolve(
    dirname(absolute),
    "../../../maxpower-training-data-governance/catalog/assets.json",
  );
  if (authorityAbsolute !== canonicalAuthorityAbsolute) {
    throw new Error("motion-quality input catalog does not reference the canonical governance catalog");
  }
  const authorityBytes = await readFile(authorityAbsolute);
  const authority = JSON.parse(authorityBytes.toString("utf8")) as AuthorityAssetCatalog;
  validateAuthorityCatalog(authority, serialized.authorityCatalog.catalogId);
  const authorityAssets = new Map(authority.assets.map((asset) => [asset.id, asset]));
  const selfAsset = authorityAssets.get(serialized.authorityCatalog.selfAssetId);
  if (!selfAsset) {
    throw new Error(`${serialized.authorityCatalog.selfAssetId}: local catalog is not registered by the authoritative catalog`);
  }
  const selfBinding = resolveAuthorityBinding(selfAsset, authority, authorityAbsolute);
  if (selfBinding.role !== "protected_runtime" || selfBinding.admission !== "protected"
      || selfBinding.groupKey !== "not_applicable") {
    throw new Error(`${selfBinding.assetId}: local catalog authority fields drifted`);
  }
  if (resolve(selfBinding.resolvedLocationPath) !== absolute) {
    throw new Error(`${selfBinding.assetId}: authoritative location does not identify the loaded local catalog`);
  }

  const resolvedAssets = {} as Record<GovernanceInputRole, GovernanceAssetBinding>;
  for (const role of GOVERNANCE_INPUT_ROLES) {
    const declared = serialized.assets[role];
    const policy = ROLE_POLICIES[role];
    if (!declared || Object.keys(declared).sort().join(",") !== "assetId,definitionSha256"
        || declared.assetId !== policy.assetId
        || !/^[a-f0-9]{64}$/u.test(declared.definitionSha256)) {
      throw new Error(`${role}: asset ID drifted from the runtime contract`);
    }
    const authorityAsset = authorityAssets.get(declared.assetId);
    if (!authorityAsset) throw new Error(`${role}: authoritative asset ${declared.assetId} is missing`);
    const authorityDefinitionSha256 = sha256(stableStringify(authorityAsset));
    if (authorityDefinitionSha256 !== declared.definitionSha256) {
      throw new Error(`${role}: authoritative asset definition drifted for ${declared.assetId}`);
    }
    const binding = resolveAuthorityBinding(
      authorityAsset,
      authority,
      authorityAbsolute,
      authorityDefinitionSha256,
    );
    if (binding.role !== policy.role || binding.admission !== policy.admission
        || binding.groupKey !== policy.groupKey) {
      throw new Error(`${role}: authoritative admission fields drifted for ${binding.assetId}`);
    }
    resolvedAssets[role] = binding;
  }

  const authorityCatalog = Object.freeze({
    catalogId: authority.catalogId,
    path: projectRelativePath(authorityAbsolute),
    sha256: sha256(authorityBytes),
    selfAssetId: selfBinding.assetId,
  });
  const value: MotionQualityInputCatalog = Object.freeze({
    schemaVersion: serialized.schemaVersion,
    catalogId: serialized.catalogId,
    authorityCatalog,
    assets: Object.freeze(resolvedAssets),
  });
  return Object.freeze({
    value,
    bytes,
    pin: pinResolvedBytes(value, selfBinding, absolute, bytes),
  });
}

export function pinInputBytes(
  catalog: MotionQualityInputCatalog,
  role: GovernanceInputRole,
  path: string,
  bytes: Buffer,
  sourceCaptureId?: string,
): InputAssetPin {
  const binding = catalog.assets[role];
  if (!binding) throw new Error(`${role}: resolved governance asset binding is missing`);
  return pinResolvedBytes(catalog, binding, resolve(path), bytes, sourceCaptureId);
}

export async function loadRawObservationSidecar(
  root: string,
  sourceCaptureId: string,
  catalog: MotionQualityInputCatalog,
): Promise<LoadedPinned<RawObservationSidecar>> {
  const normalized = normalizeSourceCaptureId(sourceCaptureId);
  const path = resolve(root, `${normalized}.halpe26.json.gz`);
  const bytes = await readFile(path);
  const value = JSON.parse((await gunzipAsync(bytes)).toString("utf8")) as RawObservationSidecar;
  validateRawObservationSidecar(value, normalized);
  return Object.freeze({
    value,
    bytes,
    pin: pinInputBytes(catalog, "rawHalpe26", path, bytes, normalized),
  });
}

export async function loadBenchEquipmentSidecar(
  root: string,
  sourceCaptureId: string,
  catalog: MotionQualityInputCatalog,
): Promise<LoadedPinned<BenchEquipmentSidecar>> {
  const normalized = normalizeSourceCaptureId(sourceCaptureId);
  const path = resolve(root, `${normalized}.barbell-pose-alignment.json.gz`);
  const bytes = await readFile(path);
  const value = JSON.parse((await gunzipAsync(bytes)).toString("utf8")) as BenchEquipmentSidecar;
  if (value.schemaVersion !== "maxpower-barbell-pose-alignment-prototype/v1"
      || value.captureId !== normalized || !Array.isArray(value.frames)) {
    throw new Error(`${normalized}: invalid bench equipment sidecar`);
  }
  assertChronological(value.frames, `${normalized} equipment`);
  return Object.freeze({
    value,
    bytes,
    pin: pinInputBytes(catalog, "benchBarbellAxis", path, bytes, normalized),
  });
}

export async function loadSourceIndependentBenchProfiles(
  path: string,
  catalog: MotionQualityInputCatalog,
): Promise<LoadedPinned<readonly SourceIndependentBenchProfileEntry[]>> {
  const absolute = resolve(path);
  const bytes = await readFile(absolute);
  const serialized = JSON.parse(bytes.toString("utf8")) as SerializedSourceIndependentBenchProfiles;
  if (serialized.schemaVersion !== "maxpower-source-independent-bench-profiles/v1"
      || serialized.evidence.source !== "builtin_source_independent_provisional"
      || serialized.evidence.fittedSourceIds.length !== 0
      || serialized.evidence.fittedDerivativeSourceIds.length !== 0) {
    throw new Error("source-independent bench profile contains fitted-source evidence");
  }
  const entries = serialized.profiles.map((entry) => {
    const identityParts = entry.profile.identity.split("/");
    if (entry.exerciseId !== "barbell_bench_press"
        || entry.profile.stateMachineId !== "barbell-axis-primary-ready-effort-return/v1"
        || identityParts[0] !== "barbell_bench_press"
        || identityParts[1] !== entry.capturePosition
        || identityParts[2] !== "bilateral"
        || identityParts[3] !== "barbell"
        || identityParts[4] !== "builtin-source-independent-provisional-v1"
        || identityParts.length !== 5) {
      throw new Error(`${entry.capturePosition}: invalid source-independent bench profile`);
    }
    const withoutHash = { ...entry.profile } as Omit<RustExerciseProfileData, "contentHash">;
    return Object.freeze({
      exerciseId: entry.exerciseId,
      capturePosition: entry.capturePosition,
      profile: Object.freeze({
        ...withoutHash,
        contentHash: computeRustExerciseProfileHash(withoutHash),
      }),
    });
  });
  if (new Set(entries.map((entry) => entry.capturePosition)).size !== 3) {
    throw new Error("source-independent bench profile must declare exactly three views");
  }
  return Object.freeze({
    value: Object.freeze(entries),
    bytes,
    pin: pinInputBytes(catalog, "sourceIndependentBenchProfile", absolute, bytes),
  });
}

export function normalizeSourceCaptureId(value: string): string {
  const normalized = value.split("::", 1)[0]?.trim() ?? "";
  if (!normalized) throw new Error("sourceCaptureId must be non-empty");
  return normalized;
}

export function rawObservationDerivativeId(sourceCaptureId: string): string {
  return `personal-native-rtmpose-halpe26-observations/${normalizeSourceCaptureId(sourceCaptureId)}`;
}

export function rawFrameCandidates(frame: RawObservationFrame): readonly PoseCandidateEstimate[] {
  if (!frame.selectedBbox || frame.landmarks.length !== 26) return Object.freeze([]);
  const bbox = normalizedRect(frame.selectedBbox, `${frame.timestampMs} selectedBbox`);
  return Object.freeze([Object.freeze({
    timestampMs: frame.timestampMs,
    candidateId: 1,
    bbox,
    torsoColor: [0, 0, 0] as const,
    landmarks: frame.landmarks.map((point) => ({
      x: finiteOrZero(point.x),
      y: finiteOrZero(point.y),
      z: finiteOrZero(point.z),
      visibility: finiteOrZero(point.visibility),
    })),
    worldLandmarks: [],
  })]);
}

export function measuredAxisToEquipmentObservation(
  axis: BenchEquipmentFrame["axis"],
  proposalId: number,
): readonly RustEquipmentObservation[] {
  if (!axis || axis.source !== "measured") return Object.freeze([]);
  const measured = axis as MeasuredBarbellAxis;
  const values = [measured.x1, measured.y1, measured.x2, measured.y2, measured.confidence];
  if (values.some((value) => !Number.isFinite(value)) || measured.confidence < 0 || measured.confidence > 1) {
    throw new Error("measured barbell axis is invalid");
  }
  const x1 = clamp01(Math.min(measured.x1, measured.x2));
  const x2 = clamp01(Math.max(measured.x1, measured.x2));
  const centerY = clamp01(measured.centerY);
  const halfHeight = 0.01;
  const y = Math.max(0, centerY - halfHeight);
  const height = Math.min(1, centerY + halfHeight) - y;
  if (x2 <= x1 || height <= 0) throw new Error("measured barbell axis has no usable span");
  return Object.freeze([Object.freeze({
    proposalId,
    kind: "barbell_shaft" as const,
    bbox: Object.freeze({ x: x1, y, width: x2 - x1, height }),
    score: measured.confidence,
    uncertaintyPx: Math.max(1, (1 - measured.confidence) * 12),
    source: "geometry" as const,
    reflectionCandidate: false,
    staticRackCandidate: false,
    occlusion: "none" as const,
    truncated: x1 === 0 || x2 === 1,
  })]);
}

export function submitRawFrameToRust(
  session: Readonly<{
    processCandidates(
      candidates: readonly PoseCandidateEstimate[],
      timestampMs: number,
      equipment: readonly RustEquipmentObservation[],
    ): unknown;
  }>,
  frame: RawObservationFrame,
  equipment: readonly RustEquipmentObservation[],
): void {
  session.processCandidates(rawFrameCandidates(frame), Math.round(frame.timestampMs), equipment);
}

export function equipmentFramesByTimestamp(
  sidecar: BenchEquipmentSidecar,
): ReadonlyMap<number, BenchEquipmentFrame> {
  return new Map(sidecar.frames.map((frame) => [Math.round(frame.timestampMs), frame]));
}

export function sha256(value: string | NodeJS.ArrayBufferView): string {
  return createHash("sha256").update(value).digest("hex");
}

function validateRawObservationSidecar(value: RawObservationSidecar, sourceCaptureId: string): void {
  if (value.schemaVersion !== "maxpower-raw-pose-observation-sidecar/v2"
      || value.captureId !== sourceCaptureId || value.poseSchema !== "halpe26"
      || value.coordinateSpace !== "image_normalized" || !Array.isArray(value.frames)) {
    throw new Error(`${sourceCaptureId}: invalid raw Halpe-26 sidecar`);
  }
  if (!Number.isSafeInteger(value.source.widthPx) || value.source.widthPx <= 0
      || !Number.isSafeInteger(value.source.heightPx) || value.source.heightPx <= 0
      || !/^[a-f0-9]{64}$/u.test(value.source.sha256)) {
    throw new Error(`${sourceCaptureId}: invalid raw source metadata`);
  }
  assertChronological(value.frames, `${sourceCaptureId} raw pose`);
  for (const frame of value.frames) {
    if (!Number.isSafeInteger(frame.frameNumber) || frame.frameNumber < 0
        || !Array.isArray(frame.landmarks)
        || (frame.landmarks.length !== 0 && frame.landmarks.length !== 26)) {
      throw new Error(`${sourceCaptureId}: invalid raw frame`);
    }
    if (frame.selectedBbox) normalizedRect(frame.selectedBbox, `${sourceCaptureId} selectedBbox`);
  }
}

function assertChronological(
  frames: readonly Readonly<{ timestampMs: number }>[],
  label: string,
): void {
  let previous = -1;
  for (const frame of frames) {
    if (!Number.isFinite(frame.timestampMs) || frame.timestampMs < 0 || frame.timestampMs <= previous) {
      throw new Error(`${label}: timestamps must be strictly increasing`);
    }
    previous = frame.timestampMs;
  }
}

function normalizedRect(
  value: Readonly<{ x: number; y: number; width: number; height: number }>,
  label: string,
): Readonly<{ x: number; y: number; width: number; height: number }> {
  const fields = [value.x, value.y, value.width, value.height];
  if (fields.some((field) => !Number.isFinite(field))
      || value.x < 0 || value.y < 0 || value.width <= 0 || value.height <= 0
      || value.x + value.width > 1.000_001 || value.y + value.height > 1.000_001) {
    throw new Error(`${label} must be a valid normalized rectangle`);
  }
  return Object.freeze({
    x: clamp01(value.x),
    y: clamp01(value.y),
    width: Math.min(value.width, 1 - clamp01(value.x)),
    height: Math.min(value.height, 1 - clamp01(value.y)),
  });
}

function projectRelativePath(absolute: string): string {
  return relative(resolve(process.cwd()), absolute).split(sep).join("/") || ".";
}

function validateAuthorityCatalog(catalog: AuthorityAssetCatalog, expectedCatalogId: string): void {
  if (catalog.schemaVersion !== "maxpower-data-asset-catalog/v1"
      || catalog.catalogId !== expectedCatalogId
      || !catalog.defaultRoots?.maxpower_source
      || !catalog.defaultRoots.power_workspace
      || !Array.isArray(catalog.assets)) {
    throw new Error("authoritative data catalog identity or schema is invalid");
  }
  const ids = new Set<string>();
  for (const asset of catalog.assets) {
    if (!asset.id || ids.has(asset.id)) throw new Error(`${asset.id || "unknown"}: duplicate or empty authoritative asset ID`);
    ids.add(asset.id);
    if (!asset.role || !asset.admission || !asset.authority || !asset.groupKey
        || !asset.location?.root || !asset.location.path || !asset.location.kind
        || !Array.isArray(asset.allowedTasks) || !Array.isArray(asset.allowedSupervision)
        || !Array.isArray(asset.forbiddenUses)) {
      throw new Error(`${asset.id}: authoritative asset fields are incomplete`);
    }
  }
}

function resolveAuthorityBinding(
  asset: AuthorityAsset,
  catalog: AuthorityAssetCatalog,
  authorityCatalogPath: string,
  definitionSha256 = sha256(stableStringify(asset)),
): GovernanceAssetBinding {
  const rootRelative = catalog.defaultRoots[asset.location.root];
  if (!rootRelative) throw new Error(`${asset.id}: authoritative root is unknown`);
  if (isAbsolute(asset.location.path) || asset.location.path.split(/[\\/]/u).includes("..")) {
    throw new Error(`${asset.id}: authoritative location escapes its declared root`);
  }
  const governanceRepoRoot = resolve(dirname(authorityCatalogPath), "..");
  const rootOverride = asset.location.root === "maxpower_source"
    ? process.env.MAXPOWER_SOURCE_ROOT
    : process.env.POWER_WORKSPACE_ROOT;
  const declaredRoot = resolve(rootOverride ?? resolve(governanceRepoRoot, rootRelative));
  const resolvedLocationPath = resolve(declaredRoot, asset.location.path);
  const escaped = relative(declaredRoot, resolvedLocationPath);
  if (escaped === ".." || escaped.startsWith(`..${sep}`) || isAbsolute(escaped)) {
    throw new Error(`${asset.id}: authoritative location escapes its declared root`);
  }
  let stat;
  try {
    stat = statSync(resolvedLocationPath);
  } catch (error) {
    throw new Error(`${asset.id}: authoritative location is missing (${String(error)})`);
  }
  if ((asset.location.kind === "file" && !stat.isFile())
      || (asset.location.kind === "directory" && !stat.isDirectory())) {
    throw new Error(`${asset.id}: authoritative location kind drifted`);
  }
  const realRoot = realpathSync(declaredRoot);
  const realLocation = realpathSync(resolvedLocationPath);
  const realEscaped = relative(realRoot, realLocation);
  if (realEscaped === ".." || realEscaped.startsWith(`..${sep}`) || isAbsolute(realEscaped)) {
    throw new Error(`${asset.id}: authoritative location escapes its declared root`);
  }
  if (asset.location.sha256) {
    if (asset.location.kind !== "file" || !/^[a-f0-9]{64}$/u.test(asset.location.sha256)) {
      throw new Error(`${asset.id}: authoritative SHA-256 declaration is invalid`);
    }
    const actual = sha256(readFileSync(resolvedLocationPath));
    if (actual !== asset.location.sha256) {
      throw new Error(`${asset.id}: authoritative SHA-256 mismatch (${actual})`);
    }
  }
  return Object.freeze({
    assetId: asset.id,
    role: asset.role,
    admission: asset.admission,
    authority: asset.authority,
    groupKey: asset.groupKey,
    location: Object.freeze({ ...asset.location }),
    definitionSha256,
    catalogSha256: asset.location.sha256 ?? null,
    resolvedLocationPath,
  });
}

function pinResolvedBytes(
  catalog: MotionQualityInputCatalog,
  binding: GovernanceAssetBinding,
  path: string,
  bytes: Buffer,
  sourceCaptureId?: string,
): InputAssetPin {
  const absolute = resolve(path);
  let authoritativeRealPath: string;
  let inputRealPath: string;
  try {
    authoritativeRealPath = realpathSync(binding.resolvedLocationPath);
    inputRealPath = realpathSync(absolute);
  } catch (error) {
    throw new Error(`${binding.assetId}: pinned input is missing or unreadable (${String(error)})`);
  }
  if (binding.location.kind === "file") {
    if (inputRealPath !== authoritativeRealPath) {
      throw new Error(`${binding.assetId}: input is outside authoritative asset location`);
    }
  } else {
    const child = relative(authoritativeRealPath, inputRealPath);
    if (!child || child === ".." || child.startsWith(`..${sep}`) || isAbsolute(child)) {
      throw new Error(`${binding.assetId}: input is outside authoritative asset location`);
    }
    if (binding.location.selector && !matchesCatalogSelector(basename(inputRealPath), binding.location.selector)) {
      throw new Error(`${binding.assetId}: input does not match authoritative selector`);
    }
  }
  const inputSha256 = sha256(bytes);
  if (binding.catalogSha256 && inputSha256 !== binding.catalogSha256) {
    throw new Error(`${binding.assetId}: authoritative SHA-256 mismatch (${inputSha256})`);
  }
  let diskBytes: Buffer;
  try {
    const stat = statSync(absolute);
    if (!stat.isFile()) throw new Error("input is not a file");
    diskBytes = readFileSync(absolute);
  } catch (error) {
    throw new Error(`${binding.assetId}: pinned input is missing or unreadable (${String(error)})`);
  }
  const diskSha256 = sha256(diskBytes);
  if (diskSha256 !== inputSha256) {
    throw new Error(`${binding.assetId}: supplied bytes drifted from the pinned input file`);
  }
  return Object.freeze({
    authorityCatalogId: catalog.authorityCatalog.catalogId,
    authorityCatalogSha256: catalog.authorityCatalog.sha256,
    assetId: binding.assetId,
    role: binding.role,
    admission: binding.admission,
    authority: binding.authority,
    groupKey: binding.groupKey,
    location: binding.location,
    definitionSha256: binding.definitionSha256,
    catalogSha256: binding.catalogSha256,
    path: projectRelativePath(absolute),
    sha256: inputSha256,
    ...(sourceCaptureId ? { sourceCaptureId } : {}),
  });
}

function matchesCatalogSelector(fileName: string, selector: string): boolean {
  if (/^\*\.[A-Za-z0-9._-]+$/u.test(selector)) return fileName.endsWith(selector.slice(1));
  throw new Error(`unsupported authoritative selector: ${selector}`);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function finiteOrZero(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
