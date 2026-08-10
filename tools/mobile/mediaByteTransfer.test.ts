import assert from "node:assert/strict";
import test from "node:test";

import {
  MediaByteTransferError,
  XhrMediaByteTransferPort,
  type MediaXhrRequest,
} from "../../src/mobile/cloud/media";

test("default XHR transfer sends the exact presigned PUT and reports native progress", async () => {
  const request = new FakeXhrRequest();
  const progress: number[] = [];
  const bytes = Uint8Array.from([1, 2, 3, 4]);
  const transfer = new XhrMediaByteTransferPort({ createRequest: () => request });

  await transfer.put({
    source: { kind: "bytes", bytes },
    url: "https://objects.example/private/upload?signature=opaque",
    headers: {
      "content-type": "application/octet-stream",
      "content-length": "4",
      "x-amz-checksum-sha256": "checksum",
    },
    totalBytes: 4,
    onProgress: (sent) => progress.push(sent),
  });

  assert.deepEqual(request.opened, {
    method: "PUT",
    url: "https://objects.example/private/upload?signature=opaque",
    async: true,
  });
  assert.deepEqual(request.headers, {
    "content-type": "application/octet-stream",
    "content-length": "4",
    "x-amz-checksum-sha256": "checksum",
  });
  assert.equal(request.body, bytes);
  assert.deepEqual(progress, [2, 4]);
});

test("React Native URI delegates to a native File upload before XHR", async () => {
  let xhrRequests = 0;
  const progress: number[] = [];
  const transfers: Array<{
    uri: string;
    url: string;
    headers: Readonly<Record<string, string>>;
    totalBytes: number;
    signal?: AbortSignal;
    onProgress?(bytesSent: number): void;
  }> = [];
  const native = new XhrMediaByteTransferPort({
    createRequest: () => {
      xhrRequests += 1;
      return new FakeXhrRequest();
    },
    isReactNative: () => true,
    nativeFileTransfer: async (input) => {
      transfers.push(input);
      input.onProgress?.(4);
    },
  });
  await native.put({
    source: { kind: "uri", uri: "content://maxpower/video/1" },
    url: "https://objects.example/upload/native",
    headers: { "content-type": "video/mp4" },
    totalBytes: 4,
    onProgress: (sent) => progress.push(sent),
  });
  assert.deepEqual(transfers, [{
    uri: "content://maxpower/video/1",
    url: "https://objects.example/upload/native",
    headers: { "content-type": "video/mp4" },
    totalBytes: 4,
    onProgress: transfers[0]?.onProgress,
  }]);
  assert.deepEqual(progress, [4]);
  assert.equal(xhrRequests, 0);
});

test("Web Blob source crosses the injectable PUT seam without conversion", async () => {
  const webRequest = new FakeXhrRequest();
  const blob = new Blob([Uint8Array.from([1, 2, 3, 4])], { type: "video/mp4" });
  const web = new XhrMediaByteTransferPort({
    createRequest: () => webRequest,
    isReactNative: () => false,
  });
  await web.put({
    source: { kind: "blob", blob },
    url: "https://objects.example/upload/web",
    headers: { "content-type": "video/mp4" },
    totalBytes: 4,
  });
  assert.equal(webRequest.body, blob);
});

test("AbortSignal stops the active native request and surfaces stable cancellation", async () => {
  const request = new FakeXhrRequest(false);
  const transfer = new XhrMediaByteTransferPort({ createRequest: () => request });
  const controller = new AbortController();
  const pending = transfer.put({
    source: { kind: "bytes", bytes: Uint8Array.from([1, 2, 3, 4]) },
    url: "https://objects.example/upload/cancel",
    headers: {},
    totalBytes: 4,
    signal: controller.signal,
  });
  await Promise.resolve();
  controller.abort();

  await assert.rejects(pending, (error: unknown) => (
    error instanceof MediaByteTransferError && error.code === "cancelled"
  ));
  assert.equal(request.abortCount, 1);
});

class FakeXhrRequest implements MediaXhrRequest {
  readonly upload: MediaXhrRequest["upload"] = { onprogress: null };
  status = 0;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  opened?: { method: string; url: string; async: boolean };
  readonly headers: Record<string, string> = {};
  body: unknown;
  abortCount = 0;

  constructor(private readonly autoComplete = true) {}

  open(method: string, url: string, async: boolean): void {
    this.opened = { method, url, async };
  }

  setRequestHeader(name: string, value: string): void {
    this.headers[name] = value;
  }

  send(body: unknown): void {
    this.body = body;
    if (!this.autoComplete) return;
    queueMicrotask(() => {
      this.upload.onprogress?.({ loaded: 2, lengthComputable: true });
      this.upload.onprogress?.({ loaded: 4, lengthComputable: true });
      this.status = 204;
      this.onload?.();
    });
  }

  abort(): void {
    this.abortCount += 1;
    this.onabort?.();
  }
}
