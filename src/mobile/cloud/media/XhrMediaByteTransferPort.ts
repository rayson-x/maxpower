import type {
  MediaByteSource,
  MediaByteTransferInput,
  MediaByteTransferPort,
} from "./model";

export type MediaByteTransferErrorCode =
  | "cancelled"
  | "http_error"
  | "network_error"
  | "source_unavailable"
  | "invalid_request";

export class MediaByteTransferError extends Error {
  constructor(
    readonly code: MediaByteTransferErrorCode,
    message = `media_byte_transfer_${code}`,
    readonly status?: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = code === "cancelled" ? "AbortError" : "MediaByteTransferError";
  }
}

export interface MediaXhrProgressEvent {
  loaded: number;
  lengthComputable: boolean;
}

/** Minimal injectable XHR surface; the default factory uses the platform global. */
export interface MediaXhrRequest {
  readonly upload: {
    onprogress: ((event: MediaXhrProgressEvent) => void) | null;
  };
  status: number;
  onload: (() => void) | null;
  onerror: (() => void) | null;
  onabort: (() => void) | null;
  open(method: string, url: string, async: boolean): void;
  setRequestHeader(name: string, value: string): void;
  send(body: unknown): void;
  abort(): void;
}

export type MediaByteRequestBody = XMLHttpRequestBodyInit | Uint8Array;

export interface NativeFileMediaByteTransferInput {
  uri: string;
  url: string;
  headers: Readonly<Record<string, string>>;
  totalBytes: number;
  signal?: AbortSignal;
  onProgress?(bytesSent: number): void;
}

export type NativeFileMediaByteTransfer = (
  input: NativeFileMediaByteTransferInput,
) => Promise<void>;

export interface XhrMediaByteTransferPortOptions {
  createRequest?: () => MediaXhrRequest;
  /** Override for platform file APIs that can stream a URI without buffering it. */
  resolveBody?: (
    source: MediaByteSource,
    signal?: AbortSignal,
  ) => MediaByteRequestBody | Promise<MediaByteRequestBody>;
  /** Used only by the Web fallback for a URI source. */
  fetch?: typeof globalThis.fetch;
  isReactNative?: () => boolean;
  /**
   * Native URI bridge. The default lazily creates an expo-file-system File and
   * uses its native UploadTask, avoiding XHR body coercion and JS buffering.
   */
  nativeFileTransfer?: NativeFileMediaByteTransfer;
}

/**
 * React Native/Web default direct-PUT adapter. Native URI sources use Expo's
 * File UploadTask; XHR provides progress for Web Blob/File and byte sources.
 */
export class XhrMediaByteTransferPort implements MediaByteTransferPort {
  private readonly createRequest: () => MediaXhrRequest;
  private readonly resolveBody: NonNullable<XhrMediaByteTransferPortOptions["resolveBody"]>;
  private readonly reactNative: boolean;
  private readonly nativeFileTransfer: NativeFileMediaByteTransfer;

  constructor(options: XhrMediaByteTransferPortOptions = {}) {
    this.createRequest = options.createRequest ?? defaultRequestFactory;
    this.reactNative = options.isReactNative?.() ?? isReactNativeRuntime();
    this.nativeFileTransfer = options.nativeFileTransfer ?? defaultNativeFileTransfer;
    this.resolveBody = options.resolveBody ?? ((source, signal) =>
      defaultBodyResolver(
        source,
        signal,
        options.fetch ?? globalThis.fetch?.bind(globalThis),
      ));
  }

  async put(input: MediaByteTransferInput): Promise<void> {
    const url = requireHttpsUrl(input.url);
    if (!Number.isSafeInteger(input.totalBytes) || input.totalBytes < 1) {
      throw new MediaByteTransferError("invalid_request");
    }
    throwIfAborted(input.signal);
    const headers = validatedHeaders(input.headers);
    if (input.source.kind === "uri" && this.reactNative) {
      try {
        await this.nativeFileTransfer({
          uri: requireSourceUri(input.source.uri),
          url,
          headers,
          totalBytes: input.totalBytes,
          ...(input.signal === undefined ? {} : { signal: input.signal }),
          ...(input.onProgress === undefined ? {} : { onProgress: input.onProgress }),
        });
        return;
      } catch (cause) {
        if (input.signal?.aborted || isAbortError(cause)) {
          throw new MediaByteTransferError("cancelled", undefined, undefined, { cause });
        }
        if (cause instanceof MediaByteTransferError) throw cause;
        throw new MediaByteTransferError("network_error", undefined, undefined, { cause });
      }
    }
    let body: MediaByteRequestBody;
    try {
      body = await this.resolveBody(input.source, input.signal);
    } catch (cause) {
      if (input.signal?.aborted || isAbortError(cause)) {
        throw new MediaByteTransferError("cancelled", undefined, undefined, { cause });
      }
      if (cause instanceof MediaByteTransferError) throw cause;
      throw new MediaByteTransferError("source_unavailable", undefined, undefined, { cause });
    }
    throwIfAborted(input.signal);

    return new Promise<void>((resolve, reject) => {
      const request = this.createRequest();
      let settled = false;
      const cleanup = () => {
        input.signal?.removeEventListener("abort", abort);
        request.upload.onprogress = null;
        request.onload = null;
        request.onerror = null;
        request.onabort = null;
      };
      const succeed = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };
      const fail = (error: MediaByteTransferError) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };
      const abort = () => {
        request.abort();
        fail(new MediaByteTransferError("cancelled"));
      };

      request.upload.onprogress = (event) => {
        const loaded = Number.isFinite(event.loaded)
          ? Math.min(input.totalBytes, Math.max(0, Math.floor(event.loaded)))
          : 0;
        input.onProgress?.(loaded);
      };
      request.onload = () => {
        if (request.status >= 200 && request.status < 300) succeed();
        else fail(new MediaByteTransferError("http_error", undefined, request.status));
      };
      request.onerror = () => fail(new MediaByteTransferError("network_error"));
      request.onabort = () => fail(new MediaByteTransferError("cancelled"));
      input.signal?.addEventListener("abort", abort, { once: true });
      if (input.signal?.aborted) {
        abort();
        return;
      }

      try {
        request.open("PUT", url, true);
        for (const [name, value] of Object.entries(headers)) {
          request.setRequestHeader(name, value);
        }
        request.send(body);
      } catch (cause) {
        fail(new MediaByteTransferError("network_error", undefined, undefined, { cause }));
      }
    });
  }
}

function defaultRequestFactory(): MediaXhrRequest {
  if (typeof XMLHttpRequest === "undefined") {
    throw new MediaByteTransferError("invalid_request", "media_byte_transfer_xhr_unavailable");
  }
  return new XMLHttpRequest() as unknown as MediaXhrRequest;
}

async function defaultBodyResolver(
  source: MediaByteSource,
  signal: AbortSignal | undefined,
  fetcher: typeof globalThis.fetch | undefined,
): Promise<MediaByteRequestBody> {
  if (source.kind === "bytes") return source.bytes;
  if (source.kind === "blob") return source.blob;
  const uri = requireSourceUri(source.uri);
  if (fetcher === undefined) throw new MediaByteTransferError("source_unavailable");
  const response = await fetcher(uri, signal === undefined ? undefined : { signal });
  if (!response.ok) {
    throw new MediaByteTransferError("source_unavailable", undefined, response.status);
  }
  return response.blob();
}

async function defaultNativeFileTransfer(input: NativeFileMediaByteTransferInput): Promise<void> {
  const { File, UploadType } = await import("expo-file-system");
  const file = new File(input.uri);
  const task = file.createUploadTask(input.url, {
    httpMethod: "PUT",
    uploadType: UploadType.BINARY_CONTENT,
    headers: { ...input.headers },
    ...(input.signal === undefined ? {} : { signal: input.signal }),
    ...(input.onProgress === undefined
      ? {}
      : { onProgress: ({ bytesSent }) => input.onProgress?.(bytesSent) }),
  });
  try {
    const result = await task.uploadAsync();
    if (result.status < 200 || result.status >= 300) {
      throw new MediaByteTransferError("http_error", undefined, result.status);
    }
  } finally {
    task.release();
  }
}

function requireHttpsUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new MediaByteTransferError("invalid_request");
  }
  if (parsed.protocol !== "https:" || !parsed.hostname || parsed.username || parsed.password) {
    throw new MediaByteTransferError("invalid_request");
  }
  return parsed.toString();
}

function requireHeader(value: string): string {
  if (!value.trim() || /[\r\n]/.test(value)) {
    throw new MediaByteTransferError("invalid_request");
  }
  return value;
}

function validatedHeaders(
  headers: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  const validated: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    validated[requireHeader(name)] = requireHeader(value);
  }
  return validated;
}

function requireSourceUri(value: string): string {
  if (!value.trim() || /[\r\n]/.test(value)) {
    throw new MediaByteTransferError("source_unavailable");
  }
  return value.trim();
}

function isReactNativeRuntime(): boolean {
  return typeof navigator !== "undefined" && navigator.product === "ReactNative";
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new MediaByteTransferError("cancelled");
}

function isAbortError(value: unknown): boolean {
  return value instanceof Error && value.name === "AbortError";
}
