import type {
  PoseEvent,
  RustQualityProjection,
  RustQualityProposalJson,
} from "./types";

const MOTN_HEADER_BYTES = 12;
const MAX_QUALITY_PAYLOAD_BYTES = 1024 * 1024;
const textDecoder = new TextDecoder("utf-8", { fatal: true });
const QLT1 = [0x51, 0x4c, 0x54, 0x31] as const;
const AXI1 = [0x41, 0x58, 0x49, 0x31] as const;
const LMC1 = [0x4c, 0x4d, 0x43, 0x31] as const;
const AXIS_HEADER_BYTES = 6;
const AXIS_RECORD_BYTES = 32;
const LENGTH_PREFIXED_EXTENSION_HEADER_BYTES = 8;

type JsonObject = Record<string, unknown>;

/**
 * Projects the Rust-owned QLT1 envelope without interpreting its exercise
 * semantics. This is transport code only: it never derives a Rep, endpoint or
 * quality conclusion.
 */
export function projectRustQualityFromPacket(
  packet: Uint8Array | ArrayBuffer,
): RustQualityProjection | null {
  const bytes = packet instanceof Uint8Array ? packet : new Uint8Array(packet);
  if (!hasMotionHeader(bytes)) return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const major = view.getUint16(4, true);
  const minor = view.getUint16(6, true);
  const declaredLength = view.getUint32(8, true);
  if (major !== 1 || minor < 8 || declaredLength !== bytes.byteLength)
    return null;

  // Locate QLT1 without assuming it is terminal. A candidate is accepted only
  // when every extension required by this contract minor consumes the exact
  // remainder of the declared MOTN packet.
  for (let offset = bytes.byteLength - 8; offset >= MOTN_HEADER_BYTES; offset -= 1) {
    if (!hasMarker(bytes, offset, QLT1)) continue;
    const payloadLength = view.getUint32(offset + 4, true);
    if (payloadLength > MAX_QUALITY_PAYLOAD_BYTES) continue;
    const payloadStart = offset + 8;
    const payloadEnd = payloadStart + payloadLength;
    if (
      !Number.isSafeInteger(payloadEnd) ||
      payloadEnd > bytes.byteLength ||
      !hasValidExtensionTail(bytes, view, minor, payloadEnd)
    )
      continue;

    const projection = decodeQualityEnvelope(
      bytes.subarray(payloadStart, payloadEnd),
    );
    if (projection !== null) return projection;
  }
  return null;
}

/** Projects QLT1 from the packet already emitted by an Android/iOS host. */
export function projectRustQualityFromBase64(
  packetBase64: string,
): RustQualityProjection | null {
  try {
    return projectRustQualityFromPacket(decodeBase64(packetBase64));
  } catch {
    return null;
  }
}

/**
 * Adds the opaque QLT1 projection to a native event. Legacy and malformed
 * packets pass through unchanged so packet compatibility is not coupled to
 * quality-envelope support.
 */
export function projectPoseEventQuality(event: PoseEvent): PoseEvent {
  if (!event.packetBase64) return event;
  const qualityProjection = projectRustQualityFromBase64(event.packetBase64);
  return qualityProjection === null ? event : { ...event, qualityProjection };
}

function decodeQualityEnvelope(
  payload: Uint8Array,
): RustQualityProjection | null {
  let payloadJson: string;
  let decoded: unknown;
  try {
    payloadJson = textDecoder.decode(payload);
    decoded = JSON.parse(payloadJson);
  } catch {
    return null;
  }
  if (
    !isObject(decoded) ||
    typeof decoded.schemaVersion !== "string" ||
    decoded.schemaVersion.length === 0 ||
    !Array.isArray(decoded.proposals)
  ) {
    return null;
  }

  const proposals: RustQualityProposalJson[] = [];
  const proposalIds: string[] = [];
  const proposalHashes: string[] = [];
  for (const candidate of decoded.proposals) {
    if (
      !isObject(candidate) ||
      typeof candidate.proposalId !== "string" ||
      typeof candidate.contentHash !== "string"
    ) {
      return null;
    }
    proposals.push(deepFreeze(candidate));
    proposalIds.push(candidate.proposalId);
    proposalHashes.push(candidate.contentHash);
  }

  return Object.freeze({
    marker: "QLT1",
    schemaVersion: decoded.schemaVersion,
    payloadJson,
    proposals: Object.freeze(proposals),
    proposalIds: Object.freeze(proposalIds),
    proposalHashes: Object.freeze(proposalHashes),
  });
}

function hasMotionHeader(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= MOTN_HEADER_BYTES &&
    bytes[0] === 0x4d &&
    bytes[1] === 0x4f &&
    bytes[2] === 0x54 &&
    bytes[3] === 0x4e
  );
}

function hasValidExtensionTail(
  bytes: Uint8Array,
  view: DataView,
  minor: number,
  offset: number,
): boolean {
  if (minor === 8) return offset === bytes.byteLength;
  if (minor < 9 || minor > 10) return false;

  if (
    offset + AXIS_HEADER_BYTES > bytes.byteLength ||
    !hasMarker(bytes, offset, AXI1)
  ) {
    return false;
  }
  const axisCount = view.getUint16(offset + 4, true);
  const axisBytes = axisCount * AXIS_RECORD_BYTES;
  const axisEnd = offset + AXIS_HEADER_BYTES + axisBytes;
  if (!Number.isSafeInteger(axisEnd) || axisEnd > bytes.byteLength) return false;

  for (
    let recordOffset = offset + AXIS_HEADER_BYTES;
    recordOffset < axisEnd;
    recordOffset += AXIS_RECORD_BYTES
  ) {
    for (let valueOffset = recordOffset + 8; valueOffset < recordOffset + 32; valueOffset += 4) {
      if (!Number.isFinite(view.getFloat32(valueOffset, true))) return false;
    }
  }
  if (minor === 9) return axisEnd === bytes.byteLength;

  if (
    axisEnd + LENGTH_PREFIXED_EXTENSION_HEADER_BYTES > bytes.byteLength ||
    !hasMarker(bytes, axisEnd, LMC1)
  ) {
    return false;
  }
  const localPayloadLength = view.getUint32(axisEnd + 4, true);
  const localPayloadStart = axisEnd + LENGTH_PREFIXED_EXTENSION_HEADER_BYTES;
  const localPayloadEnd =
    localPayloadStart + localPayloadLength;
  if (
    !Number.isSafeInteger(localPayloadEnd) ||
    localPayloadEnd !== bytes.byteLength
  ) {
    return false;
  }
  try {
    const decoded = JSON.parse(
      textDecoder.decode(bytes.subarray(localPayloadStart, localPayloadEnd)),
    );
    return isObject(decoded);
  } catch {
    return false;
  }
}

function hasMarker(
  bytes: Uint8Array,
  offset: number,
  marker: readonly number[],
): boolean {
  return (
    offset >= 0 &&
    offset + marker.length <= bytes.byteLength &&
    marker.every((value, index) => bytes[offset + index] === value)
  );
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value))
    return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function decodeBase64(value: string): Uint8Array {
  let normalized = value.replace(/\s/g, "");
  if (
    normalized.length === 0 ||
    normalized.length % 4 === 1 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized) ||
    (normalized.includes("=") && normalized.length % 4 !== 0)
  ) {
    throw new Error("invalid base64 packet");
  }
  if (!normalized.includes("=") && normalized.length % 4 !== 0) {
    normalized += "=".repeat(4 - (normalized.length % 4));
  }
  const padding = normalized.endsWith("==")
    ? 2
    : normalized.endsWith("=")
      ? 1
      : 0;
  const output = new Uint8Array(
    Math.floor((normalized.length * 3) / 4) - padding,
  );
  let outputIndex = 0;
  for (let index = 0; index < normalized.length; index += 4) {
    const a = base64Value(normalized.charCodeAt(index));
    const b = base64Value(normalized.charCodeAt(index + 1));
    const c =
      normalized[index + 2] === "="
        ? 0
        : base64Value(normalized.charCodeAt(index + 2));
    const d =
      normalized[index + 3] === "="
        ? 0
        : base64Value(normalized.charCodeAt(index + 3));
    const combined = (a << 18) | (b << 12) | (c << 6) | d;
    if (outputIndex < output.length)
      output[outputIndex++] = (combined >>> 16) & 0xff;
    if (outputIndex < output.length)
      output[outputIndex++] = (combined >>> 8) & 0xff;
    if (outputIndex < output.length) output[outputIndex++] = combined & 0xff;
  }
  return output;
}

function base64Value(code: number): number {
  if (code >= 0x41 && code <= 0x5a) return code - 0x41;
  if (code >= 0x61 && code <= 0x7a) return code - 0x61 + 26;
  if (code >= 0x30 && code <= 0x39) return code - 0x30 + 52;
  if (code === 0x2b) return 62;
  if (code === 0x2f) return 63;
  throw new Error("invalid base64 packet");
}
