import { createReadStream } from "node:fs";
import { lstat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { basename, join } from "node:path";

import {
  completeAnnotationInboxItem,
  listAnnotationInbox,
  saveArchivePoseFixture,
  type CompleteAnnotationInboxInput,
} from "./annotationInbox";
import {
  ANNOTATION_INBOX_MANIFEST_VERSION,
  annotationVideoContentType,
  isSafeAnnotationVideoFilename,
} from "../../src/pose/annotationInboxContract";

export interface AnnotationInboxServerOptions {
  readonly inboxRoot: string;
  readonly archiveRoot: string;
}

const MAX_JSON_BYTES = 64 * 1024 * 1024;

export function createAnnotationInboxServer(options: AnnotationInboxServerOptions): Server {
  return createServer((request, response) => {
    const origin = request.headers.origin;
    if (origin && !isAllowedOrigin(origin)) {
      sendJson(response, 403, { error: "origin is not allowed" });
      return;
    }
    setCorsHeaders(response, origin);
    void route(request, response, options).catch((error) => {
      if (response.headersSent) {
        response.destroy(error instanceof Error ? error : undefined);
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      const status = /not found|ENOENT/i.test(message) ? 404 : /already exists|invalid|safe|unsupported/i.test(message) ? 409 : 500;
      sendJson(response, status, { error: message });
    });
  });
}

async function route(
  request: IncomingMessage,
  response: ServerResponse,
  options: AnnotationInboxServerOptions,
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/annotation-inbox") {
    sendJson(response, 200, {
      version: ANNOTATION_INBOX_MANIFEST_VERSION,
      items: await listAnnotationInbox(options.inboxRoot),
    });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/annotation-inbox/complete") {
    const body = await readJsonBody(request) as Omit<CompleteAnnotationInboxInput, "inboxRoot" | "archiveRoot">;
    const completed = await completeAnnotationInboxItem({
      ...body,
      inboxRoot: options.inboxRoot,
      archiveRoot: options.archiveRoot,
    });
    sendJson(response, 200, { completed });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/annotation-inbox/archive-pose-fixture") {
    const body = await readJsonBody(request) as {
      captureId: string;
      fixture: Parameters<typeof saveArchivePoseFixture>[0]["fixture"];
    };
    const saved = await saveArchivePoseFixture({
      archiveRoot: options.archiveRoot,
      captureId: body.captureId,
      fixture: body.fixture,
    });
    sendJson(response, 200, saved);
    return;
  }
  if (request.method === "GET" && url.pathname.startsWith("/videos/")) {
    await serveVideo(request, response, options.inboxRoot, decodeURIComponent(url.pathname.slice("/videos/".length)));
    return;
  }
  sendJson(response, 404, { error: "not found" });
}

async function serveVideo(
  request: IncomingMessage,
  response: ServerResponse,
  inboxRoot: string,
  filename: string,
): Promise<void> {
  if (basename(filename) !== filename || !isSafeAnnotationVideoFilename(filename)) {
    throw new Error("video path is not safe");
  }
  const path = join(inboxRoot, filename);
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("video not found");
  const contentType = annotationVideoContentType(filename)!;
  const range = parseRange(request.headers.range, info.size);
  response.setHeader("Accept-Ranges", "bytes");
  response.setHeader("Content-Type", contentType);
  if (!range) {
    response.setHeader("Content-Length", info.size);
    response.writeHead(200);
    createReadStream(path).pipe(response);
    return;
  }
  response.setHeader("Content-Length", range.end - range.start + 1);
  response.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${info.size}`);
  response.writeHead(206);
  createReadStream(path, range).pipe(response);
}

function parseRange(header: string | undefined, size: number): { start: number; end: number } | null {
  if (!header) return null;
  const match = /^bytes=(\d+)-(\d*)$/.exec(header);
  if (!match) throw new Error("invalid byte range");
  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start < 0 || start >= size || requestedEnd < start) {
    throw new Error("invalid byte range");
  }
  return { start, end: Math.min(requestedEnd, size - 1) };
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_JSON_BYTES) throw new Error("annotation payload exceeds 64 MiB");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function setCorsHeaders(response: ServerResponse, origin: string | undefined): void {
  response.setHeader("Access-Control-Allow-Origin", origin ?? "http://localhost:8081");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, Range");
  response.setHeader("Access-Control-Expose-Headers", "Content-Range, Accept-Ranges");
  response.setHeader("Cache-Control", "no-store");
}

function isAllowedOrigin(origin: string): boolean {
  return /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(origin);
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  const body = `${JSON.stringify(value)}\n`;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Content-Length", Buffer.byteLength(body));
  response.writeHead(status);
  response.end(body);
}
