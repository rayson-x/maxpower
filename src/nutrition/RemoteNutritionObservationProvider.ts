import type { MediaBlobStore } from "../coach/ports";
import type { SecureCredentialPort } from "../privacy";
import type {
  NutrientEstimate,
  NutritionObservationCapabilities,
  NutritionObservationPort,
  NutritionObservationRequest,
} from "./NutritionStrategyEngine";

export type NutritionPhotoMimeType = "image/jpeg" | "image/png" | "image/webp";

export interface PreparedNutritionPhoto {
  /** Local opaque media ref only; no filename or path is sent to the remote provider. */
  id: string;
  mimeType: NutritionPhotoMimeType;
  bytes: Uint8Array;
  width: number;
  height: number;
  /** The transport can audit this boolean without retaining source metadata. */
  metadataStripped: true;
}

export interface NutritionRemoteTransport {
  estimate(input: {
    text?: string;
    inputProvenance: readonly ("text" | "photo" | "nutrition_label" | "user_note")[];
    photos: readonly PreparedNutritionPhoto[];
    credential: string;
    purpose: "meal_estimate";
    signal?: AbortSignal;
  }): Promise<{
    candidates: readonly NutrientEstimate[];
    missing: readonly string[];
  }>;
}

/**
 * The transport adapter maps vendor-specific failures to this closed contract
 * before they reach the nutrition workflow. Provider SDK error classes never
 * escape into application, Timeline or card code.
 */
export class NutritionRemoteTransportError extends Error {
  constructor(
    readonly code: "timeout" | "rate_limited" | "unsupported_input" | "content_rejected" | "cancelled",
  ) {
    super(`nutrition_remote_transport_${code}`);
    this.name = "NutritionRemoteTransportError";
  }
}

export interface RemoteNutritionObservationProviderConfig {
  /** Local media ownership is independent from the optional provider account. */
  userId: string;
  providerId: string;
  modelVersion: string;
  credential: SecureCredentialPort;
  credentialKey: { accountId: string; name: string };
  media: MediaBlobStore;
  transport: NutritionRemoteTransport;
  maxBytes?: number;
  maxPixels?: number;
}

export class NutritionObservationError extends Error {
  constructor(readonly code:
    | "cancelled"
    | "remote_llm_consent_required"
    | "media_consent_required"
    | "credential_unavailable"
    | "invalid_media"
    | "media_too_large"
    | "image_too_large"
    | "schema_invalid"
    | "timeout"
    | "rate_limited"
    | "unsupported_input"
    | "content_rejected"
    | "provider_failure",
  ) {
    super(`nutrition_observation_${code}`);
    this.name = "NutritionObservationError";
  }
}

/**
 * A production-shaped, vendor-neutral remote nutrition adapter. Credentials,
 * raw image bytes and transport details never enter CoachSession, ActionLog or
 * Timeline; the application stores only the resulting confirmation-gated
 * draft artifact. A caller may replace this adapter for any approved LLM or
 * specialized vision provider.
 */
export class RemoteNutritionObservationProvider implements NutritionObservationPort {
  private readonly maxBytes: number;
  private readonly maxPixels: number;

  constructor(private readonly config: RemoteNutritionObservationProviderConfig) {
    this.maxBytes = config.maxBytes ?? 10 * 1024 * 1024;
    this.maxPixels = config.maxPixels ?? 20_000_000;
  }

  capabilities(): NutritionObservationCapabilities {
    return {
      text: true,
      photo: true,
      nutritionLabel: true,
      cancellation: true,
      providerId: this.config.providerId,
      modelVersion: this.config.modelVersion,
    };
  }

  async estimate(input: NutritionObservationRequest): Promise<{
    candidates: readonly NutrientEstimate[];
    missing: readonly string[];
    provider: { id: string; modelVersion: string; processingScope: "text" | "photo" };
    redactionManifest?: readonly string[];
  }> {
    assertNotAborted(input.signal);
    if (input.localMediaRefs?.length && input.mediaConsent !== "provider_authorized") {
      throw new NutritionObservationError("media_consent_required");
    }
    const credential = await this.config.credential.get({
      key: { accountId: this.config.credentialKey.accountId, scope: "remote_llm", name: this.config.credentialKey.name },
    });
    if (credential.status !== "available") throw new NutritionObservationError("credential_unavailable");
    const photos = await this.preparePhotos(input.localMediaRefs ?? [], input.signal);
    const redactedText = redactNutritionText(input.text);
    assertNotAborted(input.signal);
    try {
      const result = await this.config.transport.estimate({
        ...(redactedText.text ? { text: redactedText.text } : {}),
        inputProvenance: input.inputProvenance ?? defaultInputProvenance(input),
        photos,
        credential: credential.value,
        purpose: input.purpose,
        ...(input.signal ? { signal: input.signal } : {}),
      });
      assertNotAborted(input.signal);
      assertRemoteEstimateResult(result);
      return {
        candidates: result.candidates,
        missing: result.missing,
        provider: {
          id: this.config.providerId,
          modelVersion: this.config.modelVersion,
          processingScope: photos.length ? "photo" : "text",
        },
        redactionManifest: [
          ...redactedText.redactionManifest,
          ...(photos.length ? ["request.photo.upload_metadata"] : []),
        ],
      };
    } catch (error) {
      if (error instanceof NutritionObservationError) throw error;
      if (input.signal?.aborted) throw new NutritionObservationError("cancelled");
      if (error instanceof NutritionRemoteTransportError) {
        throw new NutritionObservationError(error.code);
      }
      throw new NutritionObservationError("provider_failure");
    }
  }

  private async preparePhotos(ids: readonly string[], signal?: AbortSignal): Promise<readonly PreparedNutritionPhoto[]> {
    const result: PreparedNutritionPhoto[] = [];
    for (const id of ids) {
      assertNotAborted(signal);
      const blob = await this.config.media.get({ userId: this.config.userId, id });
      if (!blob) throw new NutritionObservationError("invalid_media");
      result.push(normalizeNutritionPhoto({
        id,
        mimeType: blob.reference.mimeType,
        bytes: blob.bytes,
      }, { maxBytes: this.maxBytes, maxPixels: this.maxPixels }));
    }
    return result;
  }
}

function redactNutritionText(value: string | undefined): {
  text: string | undefined;
  redactionManifest: readonly string[];
} {
  if (!value?.trim()) return { text: undefined, redactionManifest: [] };
  let text = value.trim();
  const redactionManifest: string[] = [];
  const redact = (pattern: RegExp, path: string) => {
    if (!pattern.test(text)) return;
    text = text.replace(pattern, "[已移除]");
    redactionManifest.push(path);
  };
  // Deliberately narrow deterministic patterns: this removes obvious direct
  // identifiers without pretending to infer identity from food preferences or
  // health/experience context needed for the task.
  redact(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "request.text.email");
  redact(/(?<!\d)(?:\+?86[-\s]?)?1[3-9]\d{9}(?!\d)/g, "request.text.phone");
  redact(/(?:住址|地址|address)\s*[:：][^\n。；;]*/gi, "request.text.address_label");
  return { text, redactionManifest };
}

/**
 * Validates image bytes rather than trusting a filename/MIME declaration and
 * strips common EXIF/XMP/text chunks in the transient upload payload. The
 * source MediaBlobStore is never overwritten.
 */
export function normalizeNutritionPhoto(
  input: { id: string; mimeType: string; bytes: Uint8Array },
  limits: { maxBytes: number; maxPixels: number },
): PreparedNutritionPhoto {
  if (!input.id || input.bytes.length === 0) throw new NutritionObservationError("invalid_media");
  if (input.bytes.length > limits.maxBytes) throw new NutritionObservationError("media_too_large");
  const detected = detectImage(input.bytes);
  if (!detected || detected.mimeType !== input.mimeType) throw new NutritionObservationError("invalid_media");
  if (!Number.isInteger(detected.width) || !Number.isInteger(detected.height) || detected.width < 1 || detected.height < 1) {
    throw new NutritionObservationError("invalid_media");
  }
  if (detected.width * detected.height > limits.maxPixels) throw new NutritionObservationError("image_too_large");
  return {
    id: input.id,
    mimeType: detected.mimeType,
    bytes: stripUploadMetadata(detected.mimeType, input.bytes),
    width: detected.width,
    height: detected.height,
    metadataStripped: true,
  };
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new NutritionObservationError("cancelled");
}

function defaultInputProvenance(input: NutritionObservationRequest) {
  return [
    ...(input.text?.trim() ? ["text" as const] : []),
    ...(input.localMediaRefs?.length ? ["photo" as const] : []),
  ];
}

function assertRemoteEstimateResult(input: {
  candidates: readonly NutrientEstimate[];
  missing: readonly string[];
}): void {
  if (!Array.isArray(input.candidates) || !Array.isArray(input.missing)) {
    throw new NutritionObservationError("schema_invalid");
  }
  if (input.candidates.length === 0) throw new NutritionObservationError("schema_invalid");
  if (input.missing.some((item) => typeof item !== "string" || !item.trim())) {
    throw new NutritionObservationError("schema_invalid");
  }
  for (const candidate of input.candidates) {
    if (
      !candidate ||
      typeof candidate.foodName !== "string" ||
      !candidate.foodName.trim() ||
      typeof candidate.portionAssumption !== "string" ||
      !candidate.portionAssumption.trim() ||
      !Array.isArray(candidate.assumptions) ||
      candidate.assumptions.length === 0 ||
      candidate.assumptions.some((item: unknown) => typeof item !== "string") ||
      !["low", "medium", "high"].includes(candidate.confidence)
    ) {
      throw new NutritionObservationError("schema_invalid");
    }
    const ranges = [
      candidate.energyRange,
      candidate.proteinGramsRange,
      candidate.fatGramsRange,
      candidate.carbohydrateGramsRange,
    ];
    if (!ranges.some(Boolean) && !input.missing.some((item) => /energy|calorie|macro|营养|热量/i.test(item))) {
      throw new NutritionObservationError("schema_invalid");
    }
    if (
      !validEnergyRange(candidate.energyRange) ||
      !validNumericRange(candidate.proteinGramsRange) ||
      !validNumericRange(candidate.fatGramsRange) ||
      !validNumericRange(candidate.carbohydrateGramsRange)
    ) {
      throw new NutritionObservationError("schema_invalid");
    }
  }
}

function validEnergyRange(value: NutrientEstimate["energyRange"]): boolean {
  if (!value) return true;
  return value.min.unit === "kcal" &&
    value.max.unit === "kcal" &&
    Number.isFinite(value.min.value) &&
    Number.isFinite(value.max.value) &&
    value.min.value >= 0 &&
    value.max.value >= value.min.value;
}

function validNumericRange(value: { min: number; max: number } | undefined): boolean {
  return !value || (
    Number.isFinite(value.min) &&
    Number.isFinite(value.max) &&
    value.min >= 0 &&
    value.max >= value.min
  );
}

function detectImage(bytes: Uint8Array): { mimeType: NutritionPhotoMimeType; width: number; height: number } | undefined {
  return detectJpeg(bytes) ?? detectPng(bytes) ?? detectWebp(bytes);
}

function detectJpeg(bytes: Uint8Array): { mimeType: "image/jpeg"; width: number; height: number } | undefined {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) return undefined;
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++]!;
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker >= 0xd0 && marker <= 0xd7) continue;
    const length = readU16BE(bytes, offset);
    if (!length || length < 2 || offset + length > bytes.length) return undefined;
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      const height = readU16BE(bytes, offset + 3);
      const width = readU16BE(bytes, offset + 5);
      return width && height ? { mimeType: "image/jpeg", width, height } : undefined;
    }
    offset += length;
  }
  return undefined;
}

function detectPng(bytes: Uint8Array): { mimeType: "image/png"; width: number; height: number } | undefined {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 24 || !signature.every((value, index) => bytes[index] === value)) return undefined;
  if (ascii(bytes, 12, 4) !== "IHDR") return undefined;
  const width = readU32BE(bytes, 16);
  const height = readU32BE(bytes, 20);
  return width && height ? { mimeType: "image/png", width, height } : undefined;
}

function detectWebp(bytes: Uint8Array): { mimeType: "image/webp"; width: number; height: number } | undefined {
  if (bytes.length < 30 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WEBP") return undefined;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const kind = ascii(bytes, offset, 4);
    const length = readU32LE(bytes, offset + 4);
    const data = offset + 8;
    if (data + length > bytes.length) return undefined;
    if (kind === "VP8X" && length >= 10) {
      return { mimeType: "image/webp", width: readU24LE(bytes, data + 4) + 1, height: readU24LE(bytes, data + 7) + 1 };
    }
    if (kind === "VP8L" && length >= 5 && bytes[data] === 0x2f) {
      const packed = readU32LE(bytes, data + 1);
      return { mimeType: "image/webp", width: (packed & 0x3fff) + 1, height: ((packed >>> 14) & 0x3fff) + 1 };
    }
    // Dimension extraction for lossy VP8 has a nontrivial frame header. It
    // is intentionally rejected rather than treating an unbounded image as safe.
    offset = data + length + (length % 2);
  }
  return undefined;
}

function stripUploadMetadata(mimeType: NutritionPhotoMimeType, bytes: Uint8Array): Uint8Array {
  if (mimeType === "image/jpeg") return stripJpegMetadata(bytes);
  if (mimeType === "image/png") return stripPngMetadata(bytes);
  return stripWebpMetadata(bytes);
}

function stripJpegMetadata(bytes: Uint8Array): Uint8Array {
  const output: number[] = [0xff, 0xd8];
  let offset = 2;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) return new Uint8Array(output.concat([...bytes.slice(offset)]));
    const markerStart = offset;
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++]!;
    if (marker === 0xda) return new Uint8Array(output.concat([...bytes.slice(markerStart)]));
    if (marker === 0xd9) { output.push(0xff, marker); break; }
    if (marker >= 0xd0 && marker <= 0xd7) { output.push(0xff, marker); continue; }
    const length = readU16BE(bytes, offset);
    if (!length || length < 2 || offset + length > bytes.length) throw new NutritionObservationError("invalid_media");
    // APP1–APP15 can carry EXIF/XMP/IPTC. Preserve only the JFIF APP0 header.
    if (marker < 0xe1 || marker > 0xef) output.push(0xff, marker, ...bytes.slice(offset, offset + length));
    offset += length;
  }
  return new Uint8Array(output);
}

function stripPngMetadata(bytes: Uint8Array): Uint8Array {
  const output: number[] = [...bytes.slice(0, 8)];
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = readU32BE(bytes, offset);
    const end = offset + 12 + length;
    if (end > bytes.length) throw new NutritionObservationError("invalid_media");
    const kind = ascii(bytes, offset + 4, 4);
    if (!["eXIf", "tEXt", "zTXt", "iTXt"].includes(kind)) output.push(...bytes.slice(offset, end));
    offset = end;
    if (kind === "IEND") break;
  }
  return new Uint8Array(output);
}

function stripWebpMetadata(bytes: Uint8Array): Uint8Array {
  const chunks: number[] = [];
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const length = readU32LE(bytes, offset + 4);
    const end = offset + 8 + length + (length % 2);
    if (end > bytes.length) throw new NutritionObservationError("invalid_media");
    const kind = ascii(bytes, offset, 4);
    if (kind !== "EXIF" && kind !== "XMP ") chunks.push(...bytes.slice(offset, end));
    offset = end;
  }
  const output = new Uint8Array(12 + chunks.length);
  output.set(bytes.slice(0, 12));
  output.set(chunks, 12);
  output[4] = (output.length - 8) & 0xff;
  output[5] = ((output.length - 8) >>> 8) & 0xff;
  output[6] = ((output.length - 8) >>> 16) & 0xff;
  output[7] = ((output.length - 8) >>> 24) & 0xff;
  return output;
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.slice(offset, offset + length));
}
function readU16BE(bytes: Uint8Array, offset: number): number { return (bytes[offset]! << 8) | bytes[offset + 1]!; }
function readU32BE(bytes: Uint8Array, offset: number): number { return ((bytes[offset]! << 24) >>> 0) | (bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!; }
function readU32LE(bytes: Uint8Array, offset: number): number { return bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16) | ((bytes[offset + 3]! << 24) >>> 0); }
function readU24LE(bytes: Uint8Array, offset: number): number { return bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16); }
