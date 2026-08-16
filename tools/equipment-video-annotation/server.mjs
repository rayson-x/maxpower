import { createReadStream } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { MANIFEST_SCHEMA } from "./annotationDocument.mjs";

const toolRoot = dirname(fileURLToPath(import.meta.url));

export async function loadManifest(manifestPath) {
  try {
    const parsed = JSON.parse(await readFile(manifestPath, "utf8"));
    validateManifest(parsed, manifestPath);
    return parsed;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return {
      schemaVersion: MANIFEST_SCHEMA,
      manifestId: "blocked-no-governed-manifest",
      status: "blocked",
      blockers: ["数据治理审计尚未通过；当前未读取或提取仓库视频。"],
      videos: [],
    };
  }
}

export async function createEquipmentAnnotationServer(options = {}) {
  const manifestPath = resolve(options.manifestPath ?? join(toolRoot, "workspace", "manifest.json"));
  const manifest = await loadManifest(manifestPath);
  const byId = new Map(manifest.videos.map((video) => [video.id, video]));
  return createServer((request, response) => {
    void route(request, response, { manifest, byId, manifestPath }).catch((error) => {
      if (response.headersSent) return response.destroy(error);
      response.writeHead(/not found/i.test(error.message) ? 404 : 400, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      response.end(JSON.stringify({ error: error.message }));
    });
  });
}

async function route(request, response, context) {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  if (request.method !== "GET") throw new Error("unsupported method");
  if (url.pathname === "/" || url.pathname === "/index.html") {
    return serveFile(response, join(toolRoot, "index.html"), "text/html; charset=utf-8");
  }
  if (["/app.mjs", "/annotationDocument.mjs"].includes(url.pathname)) {
    return serveFile(response, join(toolRoot, url.pathname.slice(1)), "text/javascript; charset=utf-8");
  }
  if (url.pathname === "/styles.css") {
    return serveFile(response, join(toolRoot, "styles.css"), "text/css; charset=utf-8");
  }
  if (url.pathname === "/api/manifest") {
    const clientManifest = {
      ...context.manifest,
      videos: context.manifest.videos.map(({ sourcePath: _privatePath, ...video }) => ({
        ...video,
        videoUrl: `/media/video?id=${encodeURIComponent(video.id)}`,
      })),
    };
    return sendJson(response, clientManifest);
  }
  if (url.pathname === "/media/video") {
    const id = url.searchParams.get("id");
    const video = id ? context.byId.get(id) : null;
    if (!video) throw new Error("video not found");
    const manifestRoot = dirname(context.manifestPath);
    const sourcePath = isAbsolute(video.sourcePath) ? resolve(video.sourcePath) : resolve(manifestRoot, video.sourcePath);
    return serveVideo(request, response, sourcePath);
  }
  throw new Error("asset not found");
}

function validateManifest(manifest, manifestPath) {
  if (!manifest || manifest.schemaVersion !== MANIFEST_SCHEMA || !Array.isArray(manifest.videos)) {
    throw new Error(`invalid equipment video manifest: ${manifestPath}`);
  }
  const ids = new Set();
  for (const video of manifest.videos) {
    if (!video || typeof video.id !== "string" || !video.id || ids.has(video.id)) {
      throw new Error("equipment video manifest has missing or duplicate video id");
    }
    if (typeof video.sourcePath !== "string" || !video.sourcePath) {
      throw new Error(`equipment video ${video.id} is missing sourcePath`);
    }
    ids.add(video.id);
  }
}

async function serveFile(response, path, contentType) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("asset not found");
  response.writeHead(200, { "Content-Type": contentType, "Content-Length": info.size });
  createReadStream(path).pipe(response);
}

async function serveVideo(request, response, path) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("video not found");
  const contentType = videoContentType(path);
  const range = request.headers.range;
  if (!range) {
    response.writeHead(200, { "Content-Type": contentType, "Content-Length": info.size, "Accept-Ranges": "bytes" });
    return createReadStream(path).pipe(response);
  }
  const match = /^bytes=(\d*)-(\d*)$/u.exec(range);
  if (!match) throw new Error("invalid video range");
  const start = match[1] ? Number(match[1]) : 0;
  const end = match[2] ? Number(match[2]) : info.size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end >= info.size) {
    response.writeHead(416, { "Content-Range": `bytes */${info.size}` });
    return response.end();
  }
  response.writeHead(206, {
    "Content-Type": contentType,
    "Content-Length": end - start + 1,
    "Content-Range": `bytes ${start}-${end}/${info.size}`,
    "Accept-Ranges": "bytes",
  });
  createReadStream(path, { start, end }).pipe(response);
}

function videoContentType(path) {
  switch (extname(path).toLowerCase()) {
    case ".mp4": return "video/mp4";
    case ".mov": return "video/quicktime";
    case ".webm": return "video/webm";
    default: return "application/octet-stream";
  }
}

function sendJson(response, value) {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Content-Length": body.length });
  response.end(body);
}

async function main() {
  const manifestPath = process.env.MAXPOWER_EQUIPMENT_VIDEO_MANIFEST;
  const port = Number(process.env.MAXPOWER_EQUIPMENT_ANNOTATION_PORT ?? 4321);
  const server = await createEquipmentAnnotationServer({ manifestPath });
  server.listen(port, "127.0.0.1", () => {
    process.stdout.write(`[equipment-video-annotation] http://127.0.0.1:${port} · localStorage drafts · JSON export only\n`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void main().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
