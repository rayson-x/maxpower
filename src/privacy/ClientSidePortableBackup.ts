import { stableHash } from "../coach/stable";
import type { BackupManifest } from "./model";
import type { PortableExportBundle } from "./PortableDataService";
import { PortableDataService } from "./PortableDataService";

export const CLIENT_ENCRYPTED_BACKUP_SCHEMA_VERSION = 1 as const;
export const CLIENT_BACKUP_KDF_ITERATIONS = 310_000;

export interface BackupCryptoPort {
  /**
   * Allows settings and write paths to fail closed before attempting a
   * backup. Older platform adapters without this probe remain supported and
   * are treated as available until an operation proves otherwise.
   */
  getAvailability?(): Promise<"available" | "unavailable">;
  randomBytes(length: number): Promise<Uint8Array>;
  deriveAes256Key(input: { passphrase: string; salt: Uint8Array; iterations: number }): Promise<Uint8Array>;
  encryptAesGcm(input: { key: Uint8Array; iv: Uint8Array; plaintext: Uint8Array; additionalData: Uint8Array }): Promise<Uint8Array>;
  decryptAesGcm(input: { key: Uint8Array; iv: Uint8Array; ciphertext: Uint8Array; additionalData: Uint8Array }): Promise<Uint8Array>;
  sha256(input: Uint8Array): Promise<Uint8Array>;
}

/** A serialized, portable and client-side encrypted form of the structured bundle. */
export interface ClientSidePortableBackup {
  kind: "maxpower_client_encrypted_backup";
  schemaVersion: typeof CLIENT_ENCRYPTED_BACKUP_SCHEMA_VERSION;
  manifest: BackupManifest & {
    encryption: "client_side";
    kdf: NonNullable<BackupManifest["kdf"]>;
    cipher: NonNullable<BackupManifest["cipher"]>;
  };
  ciphertextBase64: string;
}

export type ClientSideBackupErrorCode =
  | "crypto_unavailable"
  | "passphrase_too_short"
  | "invalid_backup_envelope"
  | "ciphertext_integrity_failed"
  | "decrypt_failed"
  | "bundle_invalid";

export class ClientSideBackupError extends Error {
  constructor(readonly code: ClientSideBackupErrorCode) {
    super(`backup_${code}`);
    this.name = "ClientSideBackupError";
  }
}

/**
 * Encrypts only the existing portable, redacted structured-data bundle. Media
 * stays excluded until a separate media-backup policy and streaming I/O path
 * exists; this method never reads any attachment store or credential store.
 */
export class ClientSidePortableBackupService {
  constructor(
    private readonly portableData: PortableDataService,
    private readonly crypto: BackupCryptoPort,
  ) {}

  async getAvailability(): Promise<"available" | "unavailable"> {
    return this.crypto.getAvailability ? this.crypto.getAvailability() : "available";
  }

  async create(input: { userId: string; passphrase: string }): Promise<ClientSidePortableBackup> {
    if (await this.getAvailability() !== "available") throw new ClientSideBackupError("crypto_unavailable");
    assertPassphrase(input.passphrase);
    const bundle = await this.portableData.exportUser(input.userId);
    const salt = await this.crypto.randomBytes(16);
    const iv = await this.crypto.randomBytes(12);
    const kdf = {
      algorithm: "PBKDF2-SHA-256" as const,
      iterations: CLIENT_BACKUP_KDF_ITERATIONS,
      saltBase64: encodeBase64(salt),
    };
    const provisionalManifest = {
      schemaVersion: CLIENT_ENCRYPTED_BACKUP_SCHEMA_VERSION,
      userId: bundle.manifest.userId,
      createdAt: bundle.manifest.createdAt,
      encryption: "client_side" as const,
      structuredContentHash: bundle.manifest.contentHash,
      kdf,
      cipher: {
        algorithm: "AES-256-GCM" as const,
        ivBase64: encodeBase64(iv),
        ciphertextHash: "",
      },
      // PortableDataService already records `media_bytes` as excluded. Do not
      // manufacture a media-inclusive backup from a structured export.
    };
    const plaintext = utf8Encode(JSON.stringify(bundle));
    const key = await this.crypto.deriveAes256Key({
      passphrase: input.passphrase,
      salt,
      iterations: kdf.iterations,
    });
    try {
      const ciphertext = await this.crypto.encryptAesGcm({
        key,
        iv,
        plaintext,
        additionalData: backupAdditionalData(provisionalManifest),
      });
      const ciphertextBase64 = encodeBase64(ciphertext);
      const manifest: ClientSidePortableBackup["manifest"] = {
        ...provisionalManifest,
        cipher: {
          ...provisionalManifest.cipher,
          ciphertextHash: `sha256-${encodeBase64(await this.crypto.sha256(ciphertext))}`,
        },
      };
      return {
        kind: "maxpower_client_encrypted_backup",
        schemaVersion: CLIENT_ENCRYPTED_BACKUP_SCHEMA_VERSION,
        manifest,
        ciphertextBase64,
      };
    } finally {
      key.fill(0);
    }
  }

  /**
   * Opens and validates a backup without mutating the Ledger. Callers still
   * use PortableDataService's dry-run/restore path for explicit restore mode.
   */
  async open(input: { archive: ClientSidePortableBackup; passphrase: string }): Promise<PortableExportBundle> {
    assertPassphrase(input.passphrase);
    validateArchiveEnvelope(input.archive);
    const salt = decodeBase64(input.archive.manifest.kdf.saltBase64);
    const iv = decodeBase64(input.archive.manifest.cipher.ivBase64);
    const ciphertext = decodeBase64(input.archive.ciphertextBase64);
    const actualHash = `sha256-${encodeBase64(await this.crypto.sha256(ciphertext))}`;
    if (actualHash !== input.archive.manifest.cipher.ciphertextHash) {
      throw new ClientSideBackupError("ciphertext_integrity_failed");
    }
    const key = await this.crypto.deriveAes256Key({
      passphrase: input.passphrase,
      salt,
      iterations: input.archive.manifest.kdf.iterations,
    });
    let plaintext: Uint8Array;
    try {
      plaintext = await this.crypto.decryptAesGcm({
        key,
        iv,
        ciphertext,
        additionalData: backupAdditionalData(input.archive.manifest),
      });
    } catch {
      throw new ClientSideBackupError("decrypt_failed");
    } finally {
      key.fill(0);
    }
    let bundle: unknown;
    try {
      bundle = JSON.parse(utf8Decode(plaintext));
    } catch {
      throw new ClientSideBackupError("bundle_invalid");
    }
    if (!isPortableExportBundle(bundle) || bundle.manifest.userId !== input.archive.manifest.userId ||
      bundle.manifest.contentHash !== input.archive.manifest.structuredContentHash ||
      stableHash(bundle.payload) !== input.archive.manifest.structuredContentHash ||
      this.portableData.dryRun(bundle).status !== "ready") {
      throw new ClientSideBackupError("bundle_invalid");
    }
    return bundle;
  }
}

/**
 * Standards-based implementation available in Node and platforms exposing
 * WebCrypto. A platform without WebCrypto must inject another BackupCryptoPort
 * rather than silently storing a plaintext backup.
 */
export class WebCryptoBackupCryptoPort implements BackupCryptoPort {
  async getAvailability(): Promise<"available" | "unavailable"> {
    try {
      requireWebCrypto();
      return "available";
    } catch {
      return "unavailable";
    }
  }

  async randomBytes(length: number): Promise<Uint8Array> {
    if (!Number.isInteger(length) || length < 1) throw new ClientSideBackupError("crypto_unavailable");
    const crypto = requireWebCrypto();
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    return bytes;
  }

  async deriveAes256Key(input: { passphrase: string; salt: Uint8Array; iterations: number }): Promise<Uint8Array> {
    const crypto = requireWebCrypto();
    const baseKey = await crypto.subtle.importKey(
      "raw",
      asWebCryptoBuffer(utf8Encode(input.passphrase)),
      "PBKDF2",
      false,
      ["deriveBits"],
    );
    const bits = await crypto.subtle.deriveBits({
      name: "PBKDF2",
      hash: "SHA-256",
      salt: asWebCryptoBuffer(input.salt),
      iterations: input.iterations,
    }, baseKey, 256);
    return new Uint8Array(bits);
  }

  async encryptAesGcm(input: { key: Uint8Array; iv: Uint8Array; plaintext: Uint8Array; additionalData: Uint8Array }): Promise<Uint8Array> {
    return this.aes("encrypt", input);
  }

  async decryptAesGcm(input: { key: Uint8Array; iv: Uint8Array; ciphertext: Uint8Array; additionalData: Uint8Array }): Promise<Uint8Array> {
    return this.aes("decrypt", input);
  }

  async sha256(input: Uint8Array): Promise<Uint8Array> {
    return new Uint8Array(await requireWebCrypto().subtle.digest("SHA-256", asWebCryptoBuffer(input)));
  }

  private async aes(
    operation: "encrypt" | "decrypt",
    input: { key: Uint8Array; iv: Uint8Array; additionalData: Uint8Array; plaintext?: Uint8Array; ciphertext?: Uint8Array },
  ): Promise<Uint8Array> {
    if (input.key.byteLength !== 32 || input.iv.byteLength !== 12) throw new ClientSideBackupError("crypto_unavailable");
    const crypto = requireWebCrypto();
    const key = await crypto.subtle.importKey("raw", asWebCryptoBuffer(input.key), { name: "AES-GCM" }, false, [operation]);
    const payload = operation === "encrypt" ? input.plaintext : input.ciphertext;
    if (!payload) throw new ClientSideBackupError("crypto_unavailable");
    return new Uint8Array(await crypto.subtle[operation]({
      name: "AES-GCM",
      iv: asWebCryptoBuffer(input.iv),
      additionalData: asWebCryptoBuffer(input.additionalData),
      tagLength: 128,
    }, key, asWebCryptoBuffer(payload)));
  }
}

function assertPassphrase(value: string): void {
  if (value.length < 12 || value.length > 1_024) throw new ClientSideBackupError("passphrase_too_short");
}

function validateArchiveEnvelope(value: ClientSidePortableBackup): void {
  if (value.kind !== "maxpower_client_encrypted_backup" ||
    value.schemaVersion !== CLIENT_ENCRYPTED_BACKUP_SCHEMA_VERSION ||
    value.manifest.schemaVersion !== CLIENT_ENCRYPTED_BACKUP_SCHEMA_VERSION ||
    value.manifest.encryption !== "client_side" ||
    value.manifest.kdf.algorithm !== "PBKDF2-SHA-256" ||
    value.manifest.kdf.iterations < CLIENT_BACKUP_KDF_ITERATIONS ||
    value.manifest.cipher.algorithm !== "AES-256-GCM" ||
    !value.manifest.userId || !value.manifest.structuredContentHash ||
    !value.manifest.cipher.ciphertextHash || !value.ciphertextBase64) {
    throw new ClientSideBackupError("invalid_backup_envelope");
  }
}

function backupAdditionalData(manifest: BackupManifest): Uint8Array {
  return utf8Encode(JSON.stringify({
    schemaVersion: manifest.schemaVersion,
    userId: manifest.userId,
    createdAt: manifest.createdAt,
    encryption: manifest.encryption,
    structuredContentHash: manifest.structuredContentHash,
    kdf: manifest.kdf,
    cipher: manifest.cipher ? {
      algorithm: manifest.cipher.algorithm,
      ivBase64: manifest.cipher.ivBase64,
    } : undefined,
  }));
}

function isPortableExportBundle(value: unknown): value is PortableExportBundle {
  return typeof value === "object" && value !== null &&
    "manifest" in value && "payload" in value &&
    typeof value.manifest === "object" && value.manifest !== null &&
    typeof value.payload === "object" && value.payload !== null;
}

function requireWebCrypto(): Crypto {
  const crypto = globalThis.crypto;
  if (!crypto?.subtle || !crypto.getRandomValues) throw new ClientSideBackupError("crypto_unavailable");
  return crypto;
}

function utf8Encode(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function utf8Decode(value: Uint8Array): string {
  return new TextDecoder().decode(value);
}

/**
 * TypeScript 6 distinguishes a potentially shared typed-array backing store
 * from WebCrypto's deliberately ArrayBuffer-only BufferSource. Copying here
 * also narrows the lifetime of raw passphrase-derived material at this edge.
 */
function asWebCryptoBuffer(value: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
}

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function encodeBase64(bytes: Uint8Array): string {
  let output = "";
  for (let offset = 0; offset < bytes.length; offset += 3) {
    const first = bytes[offset]!;
    const second = bytes[offset + 1];
    const third = bytes[offset + 2];
    output += BASE64_ALPHABET[first >> 2];
    output += BASE64_ALPHABET[((first & 0x03) << 4) | ((second ?? 0) >> 4)];
    output += second === undefined ? "=" : BASE64_ALPHABET[((second & 0x0f) << 2) | ((third ?? 0) >> 6)];
    output += third === undefined ? "=" : BASE64_ALPHABET[third & 0x3f];
  }
  return output;
}

function decodeBase64(value: string): Uint8Array {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new ClientSideBackupError("invalid_backup_envelope");
  }
  const bytes: number[] = [];
  for (let offset = 0; offset < value.length; offset += 4) {
    const chunk = value.slice(offset, offset + 4);
    const first = BASE64_ALPHABET.indexOf(chunk[0]!);
    const second = BASE64_ALPHABET.indexOf(chunk[1]!);
    const third = chunk[2] === "=" ? 0 : BASE64_ALPHABET.indexOf(chunk[2]!);
    const fourth = chunk[3] === "=" ? 0 : BASE64_ALPHABET.indexOf(chunk[3]!);
    if (first < 0 || second < 0 || third < 0 || fourth < 0) throw new ClientSideBackupError("invalid_backup_envelope");
    bytes.push((first << 2) | (second >> 4));
    if (chunk[2] !== "=") bytes.push(((second & 0x0f) << 4) | (third >> 2));
    if (chunk[3] !== "=") bytes.push(((third & 0x03) << 6) | fourth);
  }
  return new Uint8Array(bytes);
}
