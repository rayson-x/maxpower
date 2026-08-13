import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
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

interface GovernanceAssetBinding {
  readonly assetId: string;
  readonly admission: string;
  readonly authority: string;
  readonly groupKey: string;
}

export interface MotionQualityInputCatalog {
  readonly schemaVersion: "maxpower-motion-quality-input-catalog/v1";
  readonly catalogId: string;
  readonly assets: Readonly<Record<GovernanceInputRole, GovernanceAssetBinding>>;
}

export interface InputAssetPin extends GovernanceAssetBinding {
  readonly path: string;
  readonly sha256: string;
  readonly sourceCaptureId?: string;
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

export async function loadInputCatalog(path: string): Promise<LoadedPinned<MotionQualityInputCatalog>> {
  const absolute = resolve(path);
  const bytes = await readFile(absolute);
  const value = JSON.parse(bytes.toString("utf8")) as MotionQualityInputCatalog;
  if (value.schemaVersion !== "maxpower-motion-quality-input-catalog/v1") {
    throw new Error("motion-quality input catalog schema is unsupported");
  }
  const roles: readonly GovernanceInputRole[] = [
    "humanRanges", "rawHalpe26", "benchBarbellAxis", "profileArtifact",
    "blindPlan", "rustWasm", "sourceIndependentBenchProfile", "fullDataRun",
  ];
  for (const role of roles) requireBinding(value.assets[role], role);
  return Object.freeze({
    value,
    bytes,
    pin: Object.freeze({
      assetId: "motion-quality-runner-input-catalog",
      admission: "protected",
      authority: "application_runtime",
      groupKey: "not_applicable",
      path: projectRelativePath(absolute),
      sha256: sha256(bytes),
    }),
  });
}

export function pinInputBytes(
  catalog: MotionQualityInputCatalog,
  role: GovernanceInputRole,
  path: string,
  bytes: Buffer,
  sourceCaptureId?: string,
): InputAssetPin {
  const binding = requireBinding(catalog.assets[role], role);
  return Object.freeze({
    ...binding,
    path: projectRelativePath(resolve(path)),
    sha256: sha256(bytes),
    ...(sourceCaptureId ? { sourceCaptureId } : {}),
  });
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

function requireBinding(
  value: GovernanceAssetBinding | undefined,
  role: string,
): GovernanceAssetBinding {
  if (!value || !value.assetId || !value.admission || !value.authority || !value.groupKey) {
    throw new Error(`${role}: incomplete governance asset binding`);
  }
  return value;
}

function finiteOrZero(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
