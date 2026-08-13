import {
  MediaBlobStoreError,
  type MediaBlob,
  type MediaBlobReference,
  type MediaBlobStore,
} from "./model";

export interface InMemoryMediaBlobStoreOptions {
  now?: () => string;
  encryption?: MediaBlobReference["encryption"];
}

/** Minimal filesystem primitive so the media lifecycle rules stay platform-neutral. */
export interface MediaFileStoragePort {
  read(path: string): Promise<Uint8Array | null>;
  writeAtomically(path: string, bytes: Uint8Array): Promise<void>;
  remove(path: string): Promise<void>;
}

export interface FileBackedMediaBlobStoreOptions {
  storage: MediaFileStoragePort;
  /** Relative namespace inside the platform-private documents directory. */
  root: string;
  now?: () => string;
  encryption: Exclude<MediaBlobReference["encryption"], "not_encrypted">;
}

/**
 * Contract adapter for tests and local development. It deliberately models
 * unencrypted process memory; native adapters must report their own at-rest
 * protection instead of inheriting this value.
 */
export class InMemoryMediaBlobStore implements MediaBlobStore {
  private readonly records = new Map<string, MediaBlob>();
  private readonly now: () => string;
  private readonly encryption: MediaBlobReference["encryption"];

  constructor(options: InMemoryMediaBlobStoreOptions = {}) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.encryption = options.encryption ?? "not_encrypted";
  }

  async put(input: { userId: string; mimeType: string; bytes: Uint8Array }): Promise<MediaBlobReference> {
    const userId = required(input.userId);
    const mimeType = required(input.mimeType);
    if (!input.bytes.byteLength) throw new MediaBlobStoreError("invalid_input");
    const contentHash = `sha256-${sha256Hex(input.bytes)}` as const;
    const id = `media-${contentHash}`;
    const key = recordKey(userId, id);
    const existing = this.records.get(key);
    if (existing?.reference.lifecycle === "active") return cloneReference(existing.reference);
    const now = this.now();
    const reference: MediaBlobReference = {
      id,
      contentHash,
      userId,
      mimeType,
      byteLength: input.bytes.byteLength,
      encryption: this.encryption,
      replicationScope: "local_only",
      lifecycle: "active",
      createdAt: existing?.reference.createdAt ?? now,
      updatedAt: now,
    };
    this.records.set(key, { reference, bytes: new Uint8Array(input.bytes) });
    return cloneReference(reference);
  }

  async get(input: { userId: string; id: string }): Promise<MediaBlob | null> {
    const record = this.records.get(recordKey(input.userId, input.id));
    if (!record || record.reference.lifecycle !== "active") return null;
    assertBlobIntegrity(record);
    return { reference: cloneReference(record.reference), bytes: new Uint8Array(record.bytes) };
  }

  async reference(input: { userId: string; id: string }): Promise<MediaBlobReference | null> {
    const record = this.records.get(recordKey(input.userId, input.id));
    return record ? cloneReference(record.reference) : null;
  }

  async list(input: { userId: string; lifecycle?: MediaBlobReference["lifecycle"] }): Promise<readonly MediaBlobReference[]> {
    const prefix = `${required(input.userId)}\u0000`;
    return [...this.records.entries()]
      .filter(([key, record]) => key.startsWith(prefix) && (!input.lifecycle || record.reference.lifecycle === input.lifecycle))
      .map(([, record]) => cloneReference(record.reference));
  }

  async delete(input: { userId: string; id: string }): Promise<void> {
    const key = recordKey(input.userId, input.id);
    const record = this.records.get(key);
    if (!record || record.reference.lifecycle === "deleted") return;
    this.records.set(key, {
      reference: { ...record.reference, lifecycle: "deleted", updatedAt: this.now() },
      bytes: new Uint8Array(),
    });
  }
}

/**
 * Shared iOS/Android persistence implementation. Platform code supplies only
 * private-file reads, atomic writes and removal; hashing, user namespaces,
 * lifecycle and integrity checks remain identical on both clients.
 */
export class FileBackedMediaBlobStore implements MediaBlobStore {
  private readonly storage: MediaFileStoragePort;
  private readonly root: string;
  private readonly now: () => string;
  private readonly encryption: FileBackedMediaBlobStoreOptions["encryption"];
  private queue: Promise<void> = Promise.resolve();

  constructor(options: FileBackedMediaBlobStoreOptions) {
    this.storage = options.storage;
    this.root = requiredPath(options.root);
    this.now = options.now ?? (() => new Date().toISOString());
    this.encryption = options.encryption;
  }

  async put(input: { userId: string; mimeType: string; bytes: Uint8Array }): Promise<MediaBlobReference> {
    return this.serial(async () => {
      const userId = required(input.userId);
      const mimeType = required(input.mimeType);
      if (!input.bytes.byteLength) throw new MediaBlobStoreError("invalid_input");
      const contentHash = `sha256-${sha256Hex(input.bytes)}` as const;
      const id = `media-${contentHash}`;
      const records = await this.loadRecords();
      const key = persistedKey(userId, id);
      const existing = records[key];
      if (existing?.lifecycle === "active") return restoreReference(existing, userId);
      const now = this.now();
      const reference: MediaBlobReference = {
        id,
        contentHash,
        userId,
        mimeType,
        byteLength: input.bytes.byteLength,
        encryption: this.encryption,
        replicationScope: "local_only",
        lifecycle: "active",
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      try {
        await this.storage.writeAtomically(this.blobPath(userId, id), new Uint8Array(input.bytes));
        records[key] = persistReference(reference);
        await this.saveRecords(records);
      } catch (error) {
        if (error instanceof MediaBlobStoreError) throw error;
        throw new MediaBlobStoreError("write_failed");
      }
      return cloneReference(reference);
    });
  }

  async get(input: { userId: string; id: string }): Promise<MediaBlob | null> {
    return this.serial(async () => {
      const userId = required(input.userId);
      const id = required(input.id);
      const record = (await this.loadRecords())[persistedKey(userId, id)];
      if (!record || record.lifecycle !== "active") return null;
      const reference = restoreReference(record, userId);
      let bytes: Uint8Array | null;
      try {
        bytes = await this.storage.read(this.blobPath(userId, id));
      } catch {
        throw new MediaBlobStoreError("read_failed");
      }
      if (!bytes) throw new MediaBlobStoreError("integrity_failed");
      assertBlobIntegrity({ reference, bytes });
      return { reference, bytes: new Uint8Array(bytes) };
    });
  }

  async reference(input: { userId: string; id: string }): Promise<MediaBlobReference | null> {
    return this.serial(async () => {
      const userId = required(input.userId);
      const record = (await this.loadRecords())[persistedKey(userId, required(input.id))];
      return record ? restoreReference(record, userId) : null;
    });
  }

  async list(input: { userId: string; lifecycle?: MediaBlobReference["lifecycle"] }): Promise<readonly MediaBlobReference[]> {
    return this.serial(async () => {
      const userId = required(input.userId);
      const ownerHash = ownerNamespace(userId);
      return Object.values(await this.loadRecords())
        .filter((record) => record.ownerHash === ownerHash && (!input.lifecycle || record.lifecycle === input.lifecycle))
        .map((record) => restoreReference(record, userId));
    });
  }

  async delete(input: { userId: string; id: string }): Promise<void> {
    return this.serial(async () => {
      const userId = required(input.userId);
      const id = required(input.id);
      const records = await this.loadRecords();
      const key = persistedKey(userId, id);
      const existing = records[key];
      if (!existing || existing.lifecycle === "deleted") return;
      // Persist the tombstone before removing bytes. A crash may leave an
      // unreachable local file, but cannot re-present a deleted attachment.
      try {
        records[key] = { ...existing, lifecycle: "deleted", updatedAt: this.now() };
        await this.saveRecords(records);
        await this.storage.remove(this.blobPath(userId, id));
      } catch {
        throw new MediaBlobStoreError("delete_failed");
      }
    });
  }

  private async loadRecords(): Promise<Record<string, PersistedMediaReference>> {
    let bytes: Uint8Array | null;
    try {
      bytes = await this.storage.read(this.manifestPath());
    } catch {
      throw new MediaBlobStoreError("read_failed");
    }
    if (!bytes) return {};
    try {
      const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
      if (!isPersistedRecordMap(parsed)) throw new Error("invalid");
      return parsed;
    } catch {
      throw new MediaBlobStoreError("integrity_failed");
    }
  }

  private async saveRecords(records: Record<string, PersistedMediaReference>): Promise<void> {
    await this.storage.writeAtomically(this.manifestPath(), new TextEncoder().encode(JSON.stringify(records)));
  }

  private manifestPath(): string {
    return `${this.root}/manifest-v1.json`;
  }

  private blobPath(userId: string, id: string): string {
    return `${this.root}/blobs/${ownerNamespace(userId)}/${safeBlobName(id)}.blob`;
  }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }
}

/** A small dependency-free SHA-256 implementation for deterministic mobile content addressing. */
export function sha256Hex(bytes: Uint8Array): string {
  const bitLength = bytes.byteLength * 8;
  if (!Number.isSafeInteger(bitLength)) throw new MediaBlobStoreError("invalid_input");
  const paddedLength = Math.ceil((bytes.byteLength + 9) / 64) * 64;
  const data = new Uint8Array(paddedLength);
  data.set(bytes);
  data[bytes.byteLength] = 0x80;
  const view = new DataView(data.buffer);
  const high = Math.floor(bitLength / 0x1_0000_0000);
  const low = bitLength >>> 0;
  view.setUint32(paddedLength - 8, high, false);
  view.setUint32(paddedLength - 4, low, false);

  const words = new Uint32Array(64);
  let a = 0x6a09e667;
  let b = 0xbb67ae85;
  let c = 0x3c6ef372;
  let d = 0xa54ff53a;
  let e = 0x510e527f;
  let f = 0x9b05688c;
  let g = 0x1f83d9ab;
  let h = 0x5be0cd19;
  for (let offset = 0; offset < data.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) words[index] = view.getUint32(offset + index * 4, false);
    for (let index = 16; index < 64; index += 1) {
      const x = words[index - 15];
      const y = words[index - 2];
      words[index] = (((rotateRight(x, 7) ^ rotateRight(x, 18) ^ (x >>> 3)) + words[index - 16]) +
        ((rotateRight(y, 17) ^ rotateRight(y, 19) ^ (y >>> 10)) + words[index - 7])) >>> 0;
    }
    let aa = a;
    let bb = b;
    let cc = c;
    let dd = d;
    let ee = e;
    let ff = f;
    let gg = g;
    let hh = h;
    for (let index = 0; index < 64; index += 1) {
      const sigma1 = rotateRight(ee, 6) ^ rotateRight(ee, 11) ^ rotateRight(ee, 25);
      const choose = (ee & ff) ^ (~ee & gg);
      const temp1 = (hh + sigma1 + choose + SHA256_CONSTANTS[index] + words[index]) >>> 0;
      const sigma0 = rotateRight(aa, 2) ^ rotateRight(aa, 13) ^ rotateRight(aa, 22);
      const majority = (aa & bb) ^ (aa & cc) ^ (bb & cc);
      const temp2 = (sigma0 + majority) >>> 0;
      hh = gg;
      gg = ff;
      ff = ee;
      ee = (dd + temp1) >>> 0;
      dd = cc;
      cc = bb;
      bb = aa;
      aa = (temp1 + temp2) >>> 0;
    }
    a = (a + aa) >>> 0;
    b = (b + bb) >>> 0;
    c = (c + cc) >>> 0;
    d = (d + dd) >>> 0;
    e = (e + ee) >>> 0;
    f = (f + ff) >>> 0;
    g = (g + gg) >>> 0;
    h = (h + hh) >>> 0;
  }
  return [a, b, c, d, e, f, g, h].map((word) => word.toString(16).padStart(8, "0")).join("");
}

function assertBlobIntegrity(blob: MediaBlob): void {
  if (`sha256-${sha256Hex(blob.bytes)}` !== blob.reference.contentHash) {
    throw new MediaBlobStoreError("integrity_failed");
  }
}

function cloneReference(reference: MediaBlobReference): MediaBlobReference {
  return { ...reference };
}

function required(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new MediaBlobStoreError("invalid_input");
  return trimmed;
}

function recordKey(userId: string, id: string): string {
  return `${required(userId)}\u0000${required(id)}`;
}

interface PersistedMediaReference extends Omit<MediaBlobReference, "userId"> {
  ownerHash: string;
}

function persistReference(reference: MediaBlobReference): PersistedMediaReference {
  const { userId: _userId, ...rest } = reference;
  return { ...rest, ownerHash: ownerNamespace(reference.userId) };
}

function restoreReference(record: PersistedMediaReference, userId: string): MediaBlobReference {
  const { ownerHash: _ownerHash, ...reference } = record;
  return { ...reference, userId };
}

function persistedKey(userId: string, id: string): string {
  return `${ownerNamespace(userId)}\u0000${required(id)}`;
}

function ownerNamespace(userId: string): string {
  return sha256Hex(new TextEncoder().encode(required(userId)));
}

function safeBlobName(id: string): string {
  return required(id).replace(/[^A-Za-z0-9._-]/g, "_");
}

function requiredPath(path: string): string {
  const normalized = path.replace(/^\/+|\/+$/g, "");
  if (!normalized || normalized.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
    throw new MediaBlobStoreError("invalid_input");
  }
  return normalized;
}

function isPersistedRecordMap(value: unknown): value is Record<string, PersistedMediaReference> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).every((record) => {
    if (!record || typeof record !== "object" || Array.isArray(record)) return false;
    const candidate = record as Partial<PersistedMediaReference>;
    return typeof candidate.id === "string" &&
      typeof candidate.contentHash === "string" &&
      isSha256Hash(candidate.contentHash) && candidate.id === `media-${candidate.contentHash}` &&
      typeof candidate.ownerHash === "string" && isSha256Hex(candidate.ownerHash) &&
      typeof candidate.mimeType === "string" &&
      typeof candidate.byteLength === "number" && Number.isSafeInteger(candidate.byteLength) && candidate.byteLength > 0 &&
      (candidate.encryption === "platform_protected" || candidate.encryption === "client_side_encrypted") &&
      candidate.replicationScope === "local_only" &&
      (candidate.lifecycle === "active" || candidate.lifecycle === "deleted") &&
      typeof candidate.createdAt === "string" && typeof candidate.updatedAt === "string";
  });
}

function isSha256Hash(value: string): value is `sha256-${string}` {
  return value.startsWith("sha256-") && isSha256Hex(value.slice("sha256-".length));
}

function isSha256Hex(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}

function rotateRight(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

const SHA256_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
