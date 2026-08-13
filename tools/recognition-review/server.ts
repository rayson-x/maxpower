import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { dirname, extname, isAbsolute, join, resolve, sep } from "node:path";

import { BenchPhaseReviewStore } from "./benchPhaseReview";
import { DumbbellReviewStore } from "./dumbbellReview";
import { EquipmentReviewStore } from "./equipmentReview";
import { evaluatePoseKeypoints } from "./poseKeypointEvaluation";
import { PoseKeypointReviewStore } from "./poseKeypointReview";
import { RecognitionReviewRepository } from "./reviewData";
import { TechniqueReviewStore } from "./techniqueReview";

export interface RecognitionReviewServerOptions {
  readonly repository: RecognitionReviewRepository;
  readonly techniqueReviews: TechniqueReviewStore;
  readonly equipmentReviews: EquipmentReviewStore;
  readonly dumbbellReviews: DumbbellReviewStore;
  readonly poseKeypointReviews: PoseKeypointReviewStore;
  readonly benchPhaseReviews: BenchPhaseReviewStore;
  readonly pagePath: string;
  readonly equipmentPagePath: string;
  readonly dumbbellPagePath: string;
  readonly poseKeypointPagePath: string;
  readonly benchPhasePagePath: string;
  readonly benchRandomTestPagePath: string;
  readonly benchRandomTestReportPath: string;
  readonly benchRandomTestPredictionPath: string;
  readonly qualityReviewPagePath: string;
  readonly qualityReviewReleasePath: string;
  readonly qualityReviewVideoRoot: string;
  readonly clientRealtimeAgentPagePath?: string;
  readonly clientRealtimeAgentPackPath?: string;
  readonly clientRealtimeAgentPredictionPath?: string;
  readonly clientRealtimeAgentVideoRoot?: string;
}

export function createRecognitionReviewServer(options: RecognitionReviewServerOptions): Server {
  return createServer((request, response) => {
    void route(request, response, options).catch((error) => {
      if (response.headersSent) {
        response.destroy(error instanceof Error ? error : undefined);
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      const status = /not found/i.test(message)
        ? 404
        : /stale|hash mismatch|tamper/i.test(message)
          ? 409
          : /invalid|requires|too long|unsupported/i.test(message)
            ? 400
            : 500;
      sendJson(response, status, { error: message });
    });
  });
}

async function route(request: IncomingMessage, response: ServerResponse, options: RecognitionReviewServerOptions): Promise<void> {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    const body = await readFile(options.pagePath);
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.setHeader("Content-Length", body.length);
    response.writeHead(200);
    response.end(body);
    return;
  }
  if (request.method === "GET" && url.pathname === "/equipment.html") {
    const body = await readFile(options.equipmentPagePath);
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.setHeader("Content-Length", body.length);
    response.writeHead(200);
    response.end(body);
    return;
  }
  if (request.method === "GET" && url.pathname === "/dumbbell.html") {
    const body = await readFile(options.dumbbellPagePath);
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.setHeader("Content-Length", body.length);
    response.writeHead(200);
    response.end(body);
    return;
  }
  if (request.method === "GET" && url.pathname === "/pose-keypoints.html") {
    const body = await readFile(options.poseKeypointPagePath);
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.setHeader("Content-Length", body.length);
    response.writeHead(200);
    response.end(body);
    return;
  }
  if (request.method === "GET" && url.pathname === "/bench-phase.html") {
    const body = await readFile(options.benchPhasePagePath);
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.setHeader("Content-Length", body.length);
    response.writeHead(200);
    response.end(body);
    return;
  }
  if (request.method === "GET" && url.pathname === "/bench-random-test.html") {
    const body = await readFile(options.benchRandomTestPagePath);
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.setHeader("Content-Length", body.length);
    response.writeHead(200);
    response.end(body);
    return;
  }
  if (request.method === "GET" && url.pathname === "/quality-review.html") {
    await serveStaticPath(response, options.qualityReviewPagePath, "text/html; charset=utf-8");
    return;
  }
  if (request.method === "GET" && url.pathname === "/client-realtime-agent.html") {
    if (!options.clientRealtimeAgentPagePath) throw new Error("client realtime agent page not found");
    const body = await readFile(options.clientRealtimeAgentPagePath);
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.setHeader("Content-Length", body.length);
    response.writeHead(200);
    response.end(body);
    return;
  }
  if (request.method === "GET" && url.pathname === "/playerMath.js") {
    const body = await readFile(join(dirname(options.pagePath), "playerMath.js"));
    response.setHeader("Content-Type", "text/javascript; charset=utf-8");
    response.setHeader("Content-Length", body.length);
    response.writeHead(200);
    response.end(body);
    return;
  }
  if (request.method === "GET" && (
    url.pathname === "/qualityReviewDocument.js"
    || url.pathname === "/qualityReviewApp.js"
  )) {
    const filename = url.pathname.slice(1);
    await serveStaticPath(
      response,
      join(dirname(options.qualityReviewPagePath), filename),
      "text/javascript; charset=utf-8",
    );
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/review/quality-release") {
    sendJson(response, 200, await qualityReviewReleaseForClient(options));
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/review/index") {
    sendJson(response, 200, options.repository.index());
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/review/item") {
    const id = url.searchParams.get("id");
    if (!id) throw new Error("review item not found");
    sendJson(response, 200, await options.repository.detail(id));
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/review/technique") {
    const captureId = url.searchParams.get("captureId");
    if (!captureId) throw new Error("technique review item not found");
    sendJson(response, 200, options.techniqueReviews.capture(captureId));
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/review/technique") {
    sendJson(response, 201, await options.techniqueReviews.save(await readJsonBody(request)));
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/review/equipment/index") {
    sendJson(response, 200, options.equipmentReviews.index());
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/review/equipment/item") {
    const id = url.searchParams.get("id");
    if (!id) throw new Error("equipment review item not found");
    sendJson(response, 200, options.equipmentReviews.detail(id));
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/review/equipment/training") {
    sendJson(response, 200, options.equipmentReviews.trainingDataset());
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/review/equipment") {
    sendJson(response, 201, await options.equipmentReviews.save(await readJsonBody(request)));
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/review/dumbbell/index") {
    sendJson(response, 200, options.dumbbellReviews.index());
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/review/dumbbell/item") {
    const id = url.searchParams.get("id");
    if (!id) throw new Error("dumbbell review item not found");
    sendJson(response, 200, options.dumbbellReviews.detail(id));
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/review/dumbbell/training") {
    sendJson(response, 200, options.dumbbellReviews.trainingDataset());
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/review/dumbbell") {
    sendJson(response, 201, await options.dumbbellReviews.save(await readJsonBody(request)));
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/review/pose-keypoint/index") {
    sendJson(response, 200, options.poseKeypointReviews.index());
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/review/pose-keypoint/item") {
    const id = url.searchParams.get("id");
    if (!id) throw new Error("pose keypoint review item not found");
    sendJson(response, 200, options.poseKeypointReviews.detail(id));
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/review/pose-keypoint/evaluation") {
    sendJson(response, 200, options.poseKeypointReviews.evaluationDataset());
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/review/pose-keypoint/metrics") {
    sendJson(response, 200, evaluatePoseKeypoints(options.poseKeypointReviews.evaluationDataset()));
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/review/pose-keypoint") {
    sendJson(response, 201, await options.poseKeypointReviews.save(await readJsonBody(request)));
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/review/bench-phase/index") {
    sendJson(response, 200, options.benchPhaseReviews.index());
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/review/bench-phase/item") {
    const id = url.searchParams.get("id");
    if (!id) throw new Error("bench phase review item not found");
    sendJson(response, 200, options.benchPhaseReviews.detail(id));
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/review/bench-phase") {
    sendJson(response, 201, await options.benchPhaseReviews.save(await readJsonBody(request)));
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/review/bench-random-test") {
    const [reportBytes, predictionBytes] = await Promise.all([
      readFile(options.benchRandomTestReportPath),
      readFile(options.benchRandomTestPredictionPath),
    ]);
    const report = JSON.parse(reportBytes.toString("utf8")) as { capture?: { captureId?: unknown } };
    const prediction = JSON.parse(predictionBytes.toString("utf8")) as unknown;
    const captureId = report.capture?.captureId;
    if (typeof captureId !== "string" || !captureId) throw new Error("single-pass random report is invalid");
    sendJson(response, 200, {
      schemaVersion: "maxpower-bench-random-test-view/v1",
      report,
      prediction,
      evidence: options.benchPhaseReviews.detail(captureId),
      playbackPolicy: "frozen-first-pass-audit-only-no-reinference",
    });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/client-realtime-agent/pack") {
    if (!options.clientRealtimeAgentPackPath) throw new Error("client test pack not found");
    const pack = JSON.parse(await readFile(options.clientRealtimeAgentPackPath, "utf8")) as {
      cases?: Array<Record<string, unknown> & { captureId?: unknown; videoPath?: unknown }>;
    };
    assertClientPackTruthFree(pack);
    sendJson(response, 200, {
      ...pack,
      cases: (pack.cases ?? []).map(({ videoPath: _privatePath, ...testCase }) => ({
        ...testCase,
        videoUrl: `/media/client-realtime-agent?id=${encodeURIComponent(String(testCase.captureId ?? ""))}`,
      })),
    });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/client-realtime-agent/prediction") {
    if (!options.clientRealtimeAgentPredictionPath) throw new Error("client prediction not found");
    try {
      sendJson(response, 200, JSON.parse(await readFile(options.clientRealtimeAgentPredictionPath, "utf8")) as unknown);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      sendJson(response, 404, { error: "client prediction not found" });
    }
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/client-realtime-agent/prediction") {
    if (!options.clientRealtimeAgentPredictionPath) throw new Error("client prediction output not found");
    const prediction = await readJsonBody(request, 32 * 1024 * 1024) as {
      schemaVersion?: unknown;
      packSha256?: unknown;
      runtime?: { pythonVisionUsed?: unknown };
    };
    if (prediction.schemaVersion !== "maxpower-client-single-pass-prediction/v1") {
      throw new Error("invalid client prediction schema");
    }
    if (prediction.runtime?.pythonVisionUsed !== false) {
      throw new Error("client prediction must prove Python vision was not used");
    }
    const pack = JSON.parse(await readFile(options.clientRealtimeAgentPackPath!, "utf8")) as { packSha256?: unknown };
    if (prediction.packSha256 !== pack.packSha256) throw new Error("stale client prediction pack hash");
    try {
      await writeFile(options.clientRealtimeAgentPredictionPath, `${JSON.stringify(prediction, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const existing = JSON.parse(await readFile(options.clientRealtimeAgentPredictionPath, "utf8")) as { packSha256?: unknown };
      if (existing.packSha256 !== prediction.packSha256) throw new Error("stale frozen client prediction already exists");
    }
    sendJson(response, 201, { frozen: true, path: options.clientRealtimeAgentPredictionPath });
    return;
  }
  if (request.method === "GET" && url.pathname === "/media/video") {
    const id = url.searchParams.get("id");
    if (!id) throw new Error("video not found");
    await serveVideo(request, response, options.repository, id);
    return;
  }
  if (request.method === "GET" && url.pathname === "/media/equipment") {
    const id = url.searchParams.get("id");
    const kind = url.searchParams.get("kind");
    if (!id || (kind !== "image" && kind !== "preview")) throw new Error("equipment asset not found");
    await serveEquipmentAsset(response, options.equipmentReviews, id, kind);
    return;
  }
  if (request.method === "GET" && url.pathname === "/media/dumbbell") {
    const id = url.searchParams.get("id");
    if (!id) throw new Error("dumbbell asset not found");
    await serveDumbbellAsset(response, options.dumbbellReviews, id);
    return;
  }
  if (request.method === "GET" && url.pathname === "/media/pose-keypoint") {
    const id = url.searchParams.get("id");
    if (!id) throw new Error("pose keypoint asset not found");
    await servePoseKeypointAsset(response, options.poseKeypointReviews, id);
    return;
  }
  if (request.method === "GET" && url.pathname === "/media/bench-phase") {
    const id = url.searchParams.get("id");
    if (!id) throw new Error("bench phase video not found");
    await serveVideoPath(request, response, options.benchPhaseReviews.video(id).path);
    return;
  }
  if (request.method === "GET" && url.pathname === "/media/quality-review") {
    const id = url.searchParams.get("id");
    if (!id) throw new Error("quality review video not found");
    const release = await readQualityReviewRelease(options);
    const item = release.items.find((candidate) => candidate.itemId === id);
    if (!item) throw new Error("quality review video not found");
    await serveVideoPath(request, response, resolveQualityReviewVideoPath(options, item.videoPath));
    return;
  }
  if (request.method === "GET" && url.pathname === "/media/client-realtime-agent") {
    const id = url.searchParams.get("id");
    if (!id || !options.clientRealtimeAgentPackPath || !options.clientRealtimeAgentVideoRoot) {
      throw new Error("client test video not found");
    }
    const pack = JSON.parse(await readFile(options.clientRealtimeAgentPackPath, "utf8")) as {
      cases?: Array<{ captureId?: unknown; videoPath?: unknown }>;
    };
    const item = (pack.cases ?? []).find((candidate) => candidate.captureId === id);
    if (!item || typeof item.videoPath !== "string") throw new Error("client test video not found");
    const videoRoot = resolve(options.clientRealtimeAgentVideoRoot);
    const videoPath = resolve(videoRoot, item.videoPath);
    if (!videoPath.startsWith(`${videoRoot}${sep}`)) throw new Error("client test video path is invalid");
    await serveVideoPath(request, response, videoPath);
    return;
  }
  if (request.method === "GET" && (
    url.pathname === "/vendor/vision_bundle.mjs"
    || url.pathname === "/vendor/ort_bundle.mjs"
    || url.pathname.startsWith("/wasm/")
    || url.pathname.startsWith("/ort/")
    || url.pathname.startsWith("/client-harness/")
    || url.pathname.startsWith("/motion-sdk/")
    || url.pathname === "/models/yolox-nano-humanart-416x416.onnx"
    || url.pathname === "/models/rtmpose-m-halpe26-256x192.onnx"
    || url.pathname === "/models/pose_landmarker_heavy.task"
  )) {
    await servePublicAsset(response, url.pathname);
    return;
  }
  sendJson(response, 404, { error: "not found" });
}

interface QualityReviewReleaseItem extends Record<string, unknown> {
  readonly itemId: string;
  readonly videoPath: string;
  readonly proposal: Record<string, unknown>;
}

interface QualityReviewRelease extends Record<string, unknown> {
  readonly schemaVersion: "maxpower-motion-quality-review-release/v1";
  readonly releaseId: string;
  readonly releaseHash: string;
  readonly frozenAt: string;
  readonly runKind: string;
  readonly items: readonly QualityReviewReleaseItem[];
}

async function qualityReviewReleaseForClient(
  options: RecognitionReviewServerOptions,
): Promise<Record<string, unknown>> {
  const release = await readQualityReviewRelease(options);
  return {
    ...release,
    items: release.items.map(({ videoPath: _privateVideoPath, ...item }) => ({
      ...item,
      videoUrl: `/media/quality-review?id=${encodeURIComponent(item.itemId)}`,
    })),
  };
}

async function readQualityReviewRelease(
  options: RecognitionReviewServerOptions,
): Promise<QualityReviewRelease> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(options.qualityReviewReleasePath, "utf8")) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("quality review release not found");
    if (error instanceof SyntaxError) throw new Error("quality review release is invalid JSON");
    throw error;
  }
  const release = requireJsonRecord(parsed, "quality review release");
  if (release.schemaVersion !== "maxpower-motion-quality-review-release/v1") {
    throw new Error("unsupported quality review release schema");
  }
  const releaseId = requireJsonString(release.releaseId, "quality review release id");
  const releaseHash = requireJsonString(release.releaseHash, "quality review release hash");
  const frozenAt = requireJsonString(release.frozenAt, "quality review frozen timestamp");
  const runKind = requireJsonString(release.runKind, "quality review run kind");
  if (!Array.isArray(release.items)) throw new Error("quality review release items are invalid");
  requireStableHash(release, "releaseHash", releaseHash, "quality review release", true);
  if (release.evidenceRuns != null) {
    const evidenceRuns = requireJsonRecord(release.evidenceRuns, "quality review evidence runs");
    const benchmark = requireJsonRecord(evidenceRuns.benchmark, "quality review benchmark evidence");
    const frozen = requireJsonRecord(benchmark.frozenPredictions, "quality review benchmark frozen predictions");
    if (frozen.schemaVersion !== "maxpower-motion-quality-frozen-predictions/v1"
        || frozen.state !== "frozen_before_truth") {
      throw new Error("quality review benchmark frozen predictions are invalid");
    }
    const frozenDigest = requireJsonString(frozen.frozenDigest, "quality review benchmark frozen prediction hash");
    requireStableHash(
      frozen,
      "frozenDigest",
      frozenDigest,
      "quality review benchmark frozen prediction",
    );
    if (!Array.isArray(frozen.contexts)) throw new Error("quality review benchmark contexts are invalid");
    const calibration = requireJsonRecord(evidenceRuns.calibration, "quality review calibration evidence");
    if (calibration.runKind !== "full_data_proposal") {
      throw new Error("quality review calibration evidence is invalid");
    }
  }

  const itemIds = new Set<string>();
  const items = release.items.map((rawItem, index): QualityReviewReleaseItem => {
    const item = requireJsonRecord(rawItem, `quality review item ${index}`);
    const itemId = requireJsonString(item.itemId, `quality review item ${index} id`);
    if (itemIds.has(itemId)) throw new Error(`quality review item id ${itemId} is duplicated`);
    itemIds.add(itemId);
    const videoPath = requireJsonString(item.videoPath, `quality review item ${itemId} video path`);
    resolveQualityReviewVideoPath(options, videoPath);
    const proposal = requireJsonRecord(item.proposal, `quality review item ${itemId} proposal`);
    const proposalHash = requireJsonString(proposal.proposalHash, `quality review item ${itemId} proposal hash`);
    requireStableHash(proposal, "proposalHash", proposalHash, `quality review item ${itemId} proposal`);
    requireJsonRecord(proposal.lineage, `quality review item ${itemId} proposal lineage`);
    if (!Array.isArray(proposal.reps)) throw new Error(`quality review item ${itemId} proposal reps are invalid`);
    return { ...item, itemId, videoPath, proposal };
  });

  return {
    ...release,
    schemaVersion: "maxpower-motion-quality-review-release/v1",
    releaseId,
    releaseHash,
    frozenAt,
    runKind,
    items,
  };
}

function requireStableHash(
  value: Record<string, unknown>,
  hashField: string,
  storedHash: string,
  label: string,
  requireSha256Prefix = false,
): void {
  const semantic = { ...value };
  delete semantic[hashField];
  const digest = createHash("sha256").update(stableStringify(semantic)).digest("hex");
  const expected = requireSha256Prefix || storedHash.startsWith("sha256:")
    ? `sha256:${digest}`
    : digest;
  if (storedHash !== expected) throw new Error(`${label} hash mismatch`);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function resolveQualityReviewVideoPath(
  options: RecognitionReviewServerOptions,
  relativePath: string,
): string {
  if (isAbsolute(relativePath)) throw new Error("quality review video path is invalid");
  const root = resolve(options.qualityReviewVideoRoot);
  const path = resolve(root, relativePath);
  if (!path.startsWith(`${root}${sep}`)) throw new Error("quality review video path is invalid");
  return path;
}

function requireJsonRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is invalid`);
  return value as Record<string, unknown>;
}

function requireJsonString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is invalid`);
  return value.trim();
}

async function serveStaticPath(
  response: ServerResponse,
  path: string,
  contentType: string,
): Promise<void> {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("quality review asset not found");
  response.setHeader("Content-Type", contentType);
  response.setHeader("Content-Length", info.size);
  response.writeHead(200);
  createReadStream(path).pipe(response);
}

async function servePoseKeypointAsset(
  response: ServerResponse,
  store: PoseKeypointReviewStore,
  id: string,
): Promise<void> {
  const asset = store.asset(id);
  const info = await lstat(asset.path);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("pose keypoint asset not found");
  const body = await readFile(asset.path);
  if (createHash("sha256").update(body).digest("hex") !== asset.sha256) throw new Error("pose keypoint asset hash mismatch");
  response.setHeader("Content-Type", "image/jpeg");
  response.setHeader("Content-Length", body.length);
  response.writeHead(200);
  response.end(body);
}

async function serveDumbbellAsset(
  response: ServerResponse,
  store: DumbbellReviewStore,
  id: string,
): Promise<void> {
  const asset = store.asset(id);
  const info = await lstat(asset.path);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("dumbbell asset not found");
  const body = await readFile(asset.path);
  if (createHash("sha256").update(body).digest("hex") !== asset.sha256) {
    throw new Error("dumbbell asset hash mismatch");
  }
  response.setHeader("Content-Type", "image/jpeg");
  response.setHeader("Content-Length", body.length);
  response.writeHead(200);
  response.end(body);
}

async function readJsonBody(request: IncomingMessage, maximumBytes = 64 * 1024): Promise<unknown> {
  const contentType = String(request.headers["content-type"] ?? "").split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") throw new Error("invalid content type");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maximumBytes) throw new Error("review body too long");
    chunks.push(buffer);
  }
  if (!chunks.length) throw new Error("invalid review body");
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new Error("invalid review body");
  }
}

function assertClientPackTruthFree(value: unknown): void {
  const forbidden = new Set(["expectedCount", "segments", "startMs", "peakMs", "endMs"]);
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    for (const [key, child] of Object.entries(node)) {
      if (forbidden.has(key)) throw new Error(`client test pack contains forbidden truth field ${key}`);
      visit(child);
    }
  };
  visit(value);
}

async function serveEquipmentAsset(
  response: ServerResponse,
  store: EquipmentReviewStore,
  id: string,
  kind: "image" | "preview",
): Promise<void> {
  const asset = store.asset(id, kind);
  const info = await lstat(asset.path);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("equipment asset not found");
  const body = await readFile(asset.path);
  if (createHash("sha256").update(body).digest("hex") !== asset.sha256) {
    throw new Error("equipment asset hash mismatch");
  }
  response.setHeader("Content-Type", "image/jpeg");
  response.setHeader("Content-Length", body.length);
  response.writeHead(200);
  response.end(body);
}

async function servePublicAsset(response: ServerResponse, pathname: string): Promise<void> {
  const publicRoot = resolve(process.cwd(), "public");
  const assetPath = resolve(publicRoot, `.${pathname}`);
  if (!assetPath.startsWith(`${publicRoot}${sep}`)) throw new Error("asset not found");
  const info = await lstat(assetPath);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("asset not found");
  response.setHeader("Content-Length", info.size);
  response.setHeader("Content-Type", staticContentType(assetPath));
  response.writeHead(200);
  createReadStream(assetPath).pipe(response);
}

async function serveVideo(request: IncomingMessage, response: ServerResponse, repository: RecognitionReviewRepository, id: string): Promise<void> {
  const source = repository.videoStream(id);
  const info = await lstat(source.path);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("video not found");
  const range = parseByteRange(request.headers.range, info.size);
  response.setHeader("Accept-Ranges", "bytes");
  response.setHeader("Content-Type", videoContentType(source.path));
  if (!range) {
    response.setHeader("Content-Length", info.size);
    response.writeHead(200);
    createReadStream(source.path).pipe(response);
    return;
  }
  response.setHeader("Content-Length", range.end - range.start + 1);
  response.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${info.size}`);
  response.writeHead(206);
  source.stream(range).pipe(response);
}

async function serveVideoPath(request: IncomingMessage, response: ServerResponse, path: string): Promise<void> {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("bench phase video not found");
  const range = parseByteRange(request.headers.range, info.size);
  response.setHeader("Accept-Ranges", "bytes");
  response.setHeader("Content-Type", videoContentType(path));
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

export function parseByteRange(header: string | undefined, size: number): { start: number; end: number } | null {
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

function videoContentType(path: string): string {
  switch (extname(path).toLowerCase()) {
    case ".mp4": return "video/mp4";
    case ".webm": return "video/webm";
    case ".mov": return "video/quicktime";
    default: return "application/octet-stream";
  }
}

function staticContentType(path: string): string {
  switch (extname(path).toLowerCase()) {
    case ".mjs": return "text/javascript; charset=utf-8";
    case ".js": return "text/javascript; charset=utf-8";
    case ".wasm": return "application/wasm";
    case ".onnx": return "application/octet-stream";
    case ".task": return "application/octet-stream";
    default: return "application/octet-stream";
  }
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  const body = `${JSON.stringify(value)}\n`;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Content-Length", Buffer.byteLength(body));
  response.writeHead(status);
  response.end(body);
}
