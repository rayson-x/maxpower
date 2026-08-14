import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { dirname, extname, isAbsolute, join, resolve, sep } from "node:path";
import { gunzipSync } from "node:zlib";

import { BenchPhaseReviewStore } from "./benchPhaseReview";
import { DumbbellReviewStore } from "./dumbbellReview";
import { EquipmentReviewStore } from "./equipmentReview";
import { evaluatePoseKeypoints } from "./poseKeypointEvaluation";
import { PoseKeypointReviewStore } from "./poseKeypointReview";
import { RecognitionReviewRepository } from "./reviewData";
import { TechniqueReviewStore } from "./techniqueReview";
import { ACTION_CONTRACT_CATALOG } from "../motion-quality/actionContractCatalog";

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
  readonly v7AlignmentReview?: Readonly<{
    pagePath: string;
    appPath: string;
    reportPath: string;
    reportSha256: string;
    labelPath: string;
    labelSha256: string;
    poseRoot: string;
    videoRoot: string;
  }>;
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
        : /stale|hash mismatch|tamper|^v7 .*sha-?256 mismatch/i.test(message)
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
  if (request.method === "GET"
    && (url.pathname === "/v7-alignment-review.html"
      || url.pathname === "/v8-equipment-fusion-review.html")) {
    const review = requireV7AlignmentReviewOptions(options);
    await serveStaticPath(response, review.pagePath, "text/html; charset=utf-8");
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
    || url.pathname === "/qualityReviewI18n.js"
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
  if (request.method === "GET" && url.pathname === "/v7AlignmentReviewApp.js") {
    const review = requireV7AlignmentReviewOptions(options);
    await serveStaticPath(response, review.appPath, "text/javascript; charset=utf-8");
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/review/quality-release") {
    sendJson(response, 200, await qualityReviewReleaseForClient(options));
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/review/v7-alignment") {
    sendJson(response, 200, await v7AlignmentReportForClient(options));
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
    const prediction = await readJsonBody(request, 32 * 1024 * 1024);
    const pack = JSON.parse(await readFile(options.clientRealtimeAgentPackPath!, "utf8")) as unknown;
    const frozenPrediction = validateClientPredictionForFreeze(prediction, pack);
    try {
      await writeFile(
        options.clientRealtimeAgentPredictionPath,
        `${JSON.stringify(frozenPrediction, null, 2)}\n`,
        { encoding: "utf8", flag: "wx" },
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const existing = JSON.parse(await readFile(options.clientRealtimeAgentPredictionPath, "utf8")) as unknown;
      if (stableStringify(existing) !== stableStringify(frozenPrediction)) {
        throw new Error("different frozen client prediction already exists");
      }
    }
    sendJson(response, 201, {
      frozen: true,
      acceptanceEligible: false,
      path: options.clientRealtimeAgentPredictionPath,
    });
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
    const videoPath = resolveQualityReviewVideoPath(options, item.videoPath);
    await assertFileSha256(videoPath, item.videoSha256, "quality review video");
    await serveVideoPath(request, response, videoPath);
    return;
  }
  if (request.method === "GET" && url.pathname === "/media/v7-alignment") {
    const contextId = url.searchParams.get("id");
    if (!contextId) throw new Error("v7 alignment video not found");
    await serveV7AlignmentVideo(request, response, options, contextId);
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/review/v7-pose") {
    const sourceCaptureId = url.searchParams.get("id");
    if (!sourceCaptureId) throw new Error("v7 pose observation not found");
    await serveV7PoseObservation(response, options, sourceCaptureId);
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

type V7AlignmentReviewOptions = NonNullable<RecognitionReviewServerOptions["v7AlignmentReview"]>;

interface V7AlignmentReportRow extends Record<string, unknown> {
  readonly sourceCaptureId: string;
  readonly contextId: string;
  readonly exerciseId: string;
  readonly capturePosition: string;
  readonly equipmentProvider: V7EquipmentProvider;
}

interface V7EquipmentProvider extends Record<string, unknown> {
  readonly recognitionMode: string;
  readonly trackerOutputFrameCount: number;
  readonly frames: readonly V7EquipmentFrame[];
}

interface V7EquipmentFrame extends Record<string, unknown> {
  readonly frameNumber: number;
  readonly timestampMs: number;
  readonly source: "Measured" | "Predicted" | "Fused";
  readonly confidence: number;
  readonly uncertaintyPx: number;
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly centerY: number;
}

interface V7AlignmentReport extends Record<string, unknown> {
  readonly schemaVersion:
    | "maxpower-current-rust-known-video-alignment/v1"
    | "maxpower-current-rust-equipment-fused-known-video-alignment/v1";
  readonly reportDigest: string;
  readonly rows: readonly V7AlignmentReportRow[];
}

interface V7HumanLabelRecord extends Record<string, unknown> {
  readonly sourceCaptureId: string;
  readonly exerciseId: string;
  readonly capturePosition: string;
  readonly source: Readonly<{ video: string; durationMs?: number }>;
}

function requireV7AlignmentReviewOptions(options: RecognitionReviewServerOptions): V7AlignmentReviewOptions {
  if (!options.v7AlignmentReview) throw new Error("v7 alignment review not found");
  for (const [label, digest] of [
    ["v7 alignment report", options.v7AlignmentReview.reportSha256],
    ["v7 alignment labels", options.v7AlignmentReview.labelSha256],
  ] as const) {
    if (!/^[a-f0-9]{64}$/u.test(digest)) throw new Error(`${label} SHA-256 is invalid`);
  }
  return options.v7AlignmentReview;
}

async function readV7AlignmentSources(options: RecognitionReviewServerOptions): Promise<{
  review: V7AlignmentReviewOptions;
  report: V7AlignmentReport;
  labels: readonly V7HumanLabelRecord[];
}> {
  const review = requireV7AlignmentReviewOptions(options);
  await Promise.all([
    assertFileSha256(review.reportPath, review.reportSha256, "v7 alignment report"),
    assertFileSha256(review.labelPath, review.labelSha256, "v7 alignment labels"),
  ]);
  const [reportValue, labelValue] = await Promise.all([
    readJsonFile(review.reportPath, "v7 alignment report"),
    readJsonFile(review.labelPath, "v7 alignment labels"),
  ]);
  const reportRecord = requireJsonRecord(reportValue, "v7 alignment report");
  if (reportRecord.schemaVersion !== "maxpower-current-rust-known-video-alignment/v1"
    && reportRecord.schemaVersion !== "maxpower-current-rust-equipment-fused-known-video-alignment/v1") {
    throw new Error("unsupported v7 alignment report schema");
  }
  const schemaVersion = reportRecord.schemaVersion;
  const reportDigest = requireJsonString(reportRecord.reportDigest, "v7 alignment report digest");
  if (!/^[a-f0-9]{64}$/u.test(reportDigest)) throw new Error("v7 alignment report digest is invalid");
  if (!Array.isArray(reportRecord.rows) || reportRecord.rows.length === 0) {
    throw new Error("v7 alignment report rows are invalid");
  }
  const contextIds = new Set<string>();
  const rows = reportRecord.rows.map((rawRow, index): V7AlignmentReportRow => {
    const row = requireJsonRecord(rawRow, `v7 alignment row ${index}`);
    const contextId = requireJsonString(row.contextId, `v7 alignment row ${index} context`);
    if (contextIds.has(contextId)) throw new Error(`v7 alignment context ${contextId} is duplicated`);
    contextIds.add(contextId);
    return {
      ...row,
      contextId,
      sourceCaptureId: requireJsonString(row.sourceCaptureId, `v7 alignment row ${index} source`),
      exerciseId: requireJsonString(row.exerciseId, `v7 alignment row ${index} exercise`),
      capturePosition: requireJsonString(row.capturePosition, `v7 alignment row ${index} view`),
      equipmentProvider: requireV7EquipmentProvider(row.equipmentProvider, index),
    };
  });
  const labelRecord = requireJsonRecord(labelValue, "v7 alignment labels");
  if (!Array.isArray(labelRecord.records)) throw new Error("v7 alignment label records are invalid");
  const labels = labelRecord.records.map((rawLabel, index): V7HumanLabelRecord => {
    const label = requireJsonRecord(rawLabel, `v7 alignment label ${index}`);
    const source = requireJsonRecord(label.source, `v7 alignment label ${index} source metadata`);
    return {
      ...label,
      sourceCaptureId: requireJsonString(label.sourceCaptureId, `v7 alignment label ${index} source`),
      exerciseId: requireJsonString(label.exerciseId, `v7 alignment label ${index} exercise`),
      capturePosition: requireJsonString(label.capturePosition, `v7 alignment label ${index} view`),
      source: {
        video: requireJsonString(source.video, `v7 alignment label ${index} video`),
        ...(typeof source.durationMs === "number" ? { durationMs: source.durationMs } : {}),
      },
    };
  });
  for (const row of rows) exactV7Label(labels, row);
  return {
    review,
    report: {
      ...reportRecord,
      schemaVersion,
      reportDigest,
      rows,
    },
    labels,
  };
}

function requireV7EquipmentProvider(value: unknown, rowIndex: number): V7EquipmentProvider {
  const label = `v7 alignment row ${rowIndex} equipment provider`;
  const provider = requireJsonRecord(value, label);
  const recognitionMode = requireJsonString(provider.recognitionMode, `${label} mode`);
  const trackerOutputFrameCount = requireJsonNonNegativeInteger(
    provider.trackerOutputFrameCount,
    `${label} tracker frame count`,
  );
  if (!Array.isArray(provider.frames)) throw new Error(`${label} frames are invalid`);
  let previousFrameNumber = -1;
  let previousTimestampMs = -1;
  const frames = provider.frames.map((valueFrame, frameIndex): V7EquipmentFrame => {
    const frameLabel = `${label} frame ${frameIndex}`;
    const frame = requireJsonRecord(valueFrame, frameLabel);
    const frameNumber = requireJsonNonNegativeInteger(frame.frameNumber, `${frameLabel} number`);
    const timestampMs = requireJsonNonNegativeInteger(frame.timestampMs, `${frameLabel} timestamp`);
    if (frameNumber <= previousFrameNumber || timestampMs <= previousTimestampMs) {
      throw new Error(`${label} frame order is invalid`);
    }
    previousFrameNumber = frameNumber;
    previousTimestampMs = timestampMs;
    const source = requireJsonString(frame.source, `${frameLabel} source`);
    if (source !== "Measured" && source !== "Predicted" && source !== "Fused") {
      throw new Error(`${frameLabel} source is invalid`);
    }
    const confidence = requireJsonFiniteNumber(frame.confidence, `${frameLabel} confidence`);
    const uncertaintyPx = requireJsonFiniteNumber(frame.uncertaintyPx, `${frameLabel} uncertainty`);
    if (confidence < 0 || confidence > 1 || uncertaintyPx < 0) {
      throw new Error(`${frameLabel} confidence or uncertainty is invalid`);
    }
    return {
      ...frame,
      frameNumber,
      timestampMs,
      source,
      confidence,
      uncertaintyPx,
      x1: requireJsonFiniteNumber(frame.x1, `${frameLabel} x1`),
      y1: requireJsonFiniteNumber(frame.y1, `${frameLabel} y1`),
      x2: requireJsonFiniteNumber(frame.x2, `${frameLabel} x2`),
      y2: requireJsonFiniteNumber(frame.y2, `${frameLabel} y2`),
      centerY: requireJsonFiniteNumber(frame.centerY, `${frameLabel} center y`),
    };
  });
  if (trackerOutputFrameCount !== frames.length) {
    throw new Error(`${label} tracker frame count is invalid`);
  }
  return { ...provider, recognitionMode, trackerOutputFrameCount, frames };
}

async function readJsonFile(path: string, label: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error(`${label} not found`);
    if (error instanceof SyntaxError) throw new Error(`${label} is invalid JSON`);
    throw error;
  }
}

function exactV7Label(
  labels: readonly V7HumanLabelRecord[],
  row: Pick<V7AlignmentReportRow, "sourceCaptureId" | "exerciseId" | "capturePosition">,
): V7HumanLabelRecord {
  const matches = labels.filter((label) => label.sourceCaptureId === row.sourceCaptureId
    && label.exerciseId === row.exerciseId
    && label.capturePosition === row.capturePosition);
  if (matches.length !== 1) throw new Error(`v7 alignment exact label mismatch for ${row.sourceCaptureId}`);
  return matches[0]!;
}

async function v7AlignmentReportForClient(
  options: RecognitionReviewServerOptions,
): Promise<Record<string, unknown>> {
  const { report, labels } = await readV7AlignmentSources(options);
  return {
    ...report,
    rows: report.rows.map((row) => {
      const label = exactV7Label(labels, row);
      return {
        ...row,
        phaseOrder: requireV7PhaseOrder(row.exerciseId),
        phaseContractSource: "action-contract-catalog",
        durationMs: label.source.durationMs ?? null,
        videoUrl: `/media/v7-alignment?id=${encodeURIComponent(row.contextId)}`,
        poseUrl: `/api/review/v7-pose?id=${encodeURIComponent(row.sourceCaptureId)}`,
      };
    }),
  };
}

function requireV7PhaseOrder(exerciseId: string): readonly ["concentric" | "eccentric", "concentric" | "eccentric"] {
  const contract = ACTION_CONTRACT_CATALOG.find((candidate) => candidate.exerciseId === exerciseId);
  if (!contract) throw new Error(`v7 action contract not found for ${exerciseId}`);
  return contract.phase.order;
}

function resolveV7Path(rootPath: string, relativePath: string, label: string): string {
  if (isAbsolute(relativePath)) throw new Error(`${label} path is invalid`);
  const root = resolve(rootPath);
  const path = resolve(root, relativePath);
  if (!path.startsWith(`${root}${sep}`)) throw new Error(`${label} path is invalid`);
  return path;
}

function v7PosePath(review: V7AlignmentReviewOptions, sourceCaptureId: string): string {
  if (!/^[a-zA-Z0-9._-]+$/u.test(sourceCaptureId)) throw new Error("v7 pose observation id is invalid");
  return resolveV7Path(review.poseRoot, `${sourceCaptureId}.halpe26.json.gz`, "v7 pose observation");
}

async function readV7PoseMetadata(
  review: V7AlignmentReviewOptions,
  sourceCaptureId: string,
): Promise<Record<string, unknown>> {
  const path = v7PosePath(review, sourceCaptureId);
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("v7 pose observation not found");
  let parsed: unknown;
  try {
    parsed = JSON.parse(gunzipSync(await readFile(path)).toString("utf8")) as unknown;
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error("v7 pose observation is invalid JSON");
    throw error;
  }
  const pose = requireJsonRecord(parsed, "v7 pose observation");
  if (pose.captureId !== sourceCaptureId || pose.poseSchema !== "halpe26" || !Array.isArray(pose.frames)) {
    throw new Error("v7 pose observation identity is invalid");
  }
  return pose;
}

async function serveV7PoseObservation(
  response: ServerResponse,
  options: RecognitionReviewServerOptions,
  sourceCaptureId: string,
): Promise<void> {
  const { review, report } = await readV7AlignmentSources(options);
  if (!report.rows.some((row) => row.sourceCaptureId === sourceCaptureId)) {
    throw new Error("v7 pose observation not found");
  }
  const path = v7PosePath(review, sourceCaptureId);
  const pose = await readV7PoseMetadata(review, sourceCaptureId);
  const info = await lstat(path);
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Content-Encoding", "gzip");
  response.setHeader("Content-Length", info.size);
  response.setHeader("X-MaxPower-Pose-Frames", String((pose.frames as unknown[]).length));
  response.writeHead(200);
  createReadStream(path).pipe(response);
}

async function serveV7AlignmentVideo(
  request: IncomingMessage,
  response: ServerResponse,
  options: RecognitionReviewServerOptions,
  contextId: string,
): Promise<void> {
  const { review, report, labels } = await readV7AlignmentSources(options);
  const row = report.rows.find((candidate) => candidate.contextId === contextId);
  if (!row) throw new Error("v7 alignment video not found");
  const label = exactV7Label(labels, row);
  const videoPath = resolveV7Path(review.videoRoot, label.source.video, "v7 alignment video");
  const pose = await readV7PoseMetadata(review, row.sourceCaptureId);
  const source = requireJsonRecord(pose.source, "v7 pose source");
  const videoSha256 = requireJsonString(source.sha256, "v7 pose source video hash");
  if (!/^[a-f0-9]{64}$/u.test(videoSha256)) throw new Error("v7 pose source video hash is invalid");
  await assertFileSha256(videoPath, videoSha256, "v7 alignment video");
  await serveVideoPath(request, response, videoPath);
}

interface QualityReviewReleaseItem extends Record<string, unknown> {
  readonly itemId: string;
  readonly videoPath: string;
  readonly videoSha256: string;
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
        && frozen.schemaVersion !== "maxpower-motion-quality-touched-benchmark-predictions/v1") {
      throw new Error("quality review benchmark frozen predictions are invalid");
    }
    if (frozen.state !== "frozen_before_truth") {
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
    const videoSha256 = requireJsonString(
      item.videoSha256,
      `quality review item ${itemId} video SHA-256`,
    );
    if (!/^[a-f0-9]{64}$/u.test(videoSha256)) {
      throw new Error(`quality review item ${itemId} video SHA-256 is invalid`);
    }
    const proposal = requireJsonRecord(item.proposal, `quality review item ${itemId} proposal`);
    const proposalHash = requireJsonString(proposal.proposalHash, `quality review item ${itemId} proposal hash`);
    requireStableHash(proposal, "proposalHash", proposalHash, `quality review item ${itemId} proposal`);
    requireJsonRecord(proposal.lineage, `quality review item ${itemId} proposal lineage`);
    if (!Array.isArray(proposal.reps)) throw new Error(`quality review item ${itemId} proposal reps are invalid`);
    return { ...item, itemId, videoPath, videoSha256, proposal };
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

async function assertFileSha256(path: string, expected: string, label: string): Promise<void> {
  const hash = createHash("sha256");
  await new Promise<void>((resolvePromise, reject) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("error", reject);
    stream.once("end", resolvePromise);
  });
  if (hash.digest("hex") !== expected) throw new Error(`${label} SHA-256 mismatch`);
}

function requireJsonRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is invalid`);
  return value as Record<string, unknown>;
}

function requireJsonString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is invalid`);
  return value.trim();
}

function requireJsonFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} is invalid`);
  return value;
}

function requireJsonNonNegativeInteger(value: unknown, label: string): number {
  const number = requireJsonFiniteNumber(value, label);
  if (!Number.isInteger(number) || number < 0) throw new Error(`${label} is invalid`);
  return number;
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

const PINNED_CLIENT_RUNTIME = Object.freeze({
  onnxRuntime: "onnxruntime-web@1.22.0",
  yolox: Object.freeze({
    id: "yolox-nano-humanart-416x416",
    publicPath: "/models/yolox-nano-humanart-416x416.onnx",
    bytes: 3_722_395,
    sha256: "1450966de24902b18aada1a78913d7efd8fc8dcd51bd4d0d5591476bd4a38821",
  }),
  rtmpose: Object.freeze({
    id: "rtmpose-m-halpe26-256x192",
    publicPath: "/models/rtmpose-m-halpe26-256x192.onnx",
    bytes: 55_685_444,
    sha256: "26f3a19e61304a600dfb82d1001d41d24343b89fc70a33ffc84657e0b0bf2ecf",
  }),
  rustWasm: Object.freeze({
    id: "maxpower-motion-sdk-wasm",
    publicPath: "/motion-sdk/maxpower_motion_sdk.wasm",
    bytes: 495_415,
    sha256: "176da2451d029e170243cac4f2df6a92aeb9464c901bef75586066fa93a7c8b6",
  }),
});

export function validateClientPredictionForFreeze(
  rawPrediction: unknown,
  rawPack: unknown,
): Record<string, unknown> {
  const prediction = requireJsonRecord(rawPrediction, "client prediction");
  const pack = requireJsonRecord(rawPack, "client test pack");
  assertClientPackTruthFree(pack);
  const packSha256 = requireJsonString(pack.packSha256, "client test pack SHA-256");
  const { packSha256: _packDigest, ...packSemantic } = pack;
  if (!/^[a-f0-9]{64}$/u.test(packSha256)
      || createHash("sha256").update(JSON.stringify(packSemantic)).digest("hex") !== packSha256) {
    throw new Error("client test pack SHA-256 mismatch");
  }
  if (prediction.schemaVersion !== "maxpower-client-single-pass-prediction/v2"
      || prediction.packSha256 !== packSha256) {
    throw new Error("invalid or stale client prediction");
  }
  const identity = requireJsonRecord(prediction.predictionIdentity, "client prediction identity");
  const identitySha256 = requireJsonString(
    prediction.predictionIdentitySha256,
    "client prediction identity SHA-256",
  );
  if (identity.schemaVersion !== "maxpower-client-prediction-identity/v1"
      || identity.packSha256 !== packSha256
      || createHash("sha256").update(stableStringify(identity)).digest("hex") !== identitySha256) {
    throw new Error("client prediction identity hash mismatch");
  }
  if (identity.profileArchiveSha256 !== pack.sourceProfilesSha256) {
    throw new Error("client prediction profile archive mismatch");
  }
  const models = requireJsonRecord(identity.models, "client prediction models");
  requireExactJson(models.yolox, PINNED_CLIENT_RUNTIME.yolox, "YOLOX identity");
  requireExactJson(models.rtmpose, PINNED_CLIENT_RUNTIME.rtmpose, "RTMPose identity");
  requireExactJson(identity.rustWasm, PINNED_CLIENT_RUNTIME.rustWasm, "Rust WASM identity");
  const identityRuntime = requireJsonRecord(identity.runtime, "client prediction runtime identity");
  if (identityRuntime.onnxRuntime !== PINNED_CLIENT_RUNTIME.onnxRuntime
      || (identityRuntime.yoloxExecutionProvider !== "webgpu"
        && identityRuntime.yoloxExecutionProvider !== "wasm")
      || (identityRuntime.rtmposeExecutionProvider !== "webgpu"
        && identityRuntime.rtmposeExecutionProvider !== "wasm")
      || identityRuntime.motionPacketContract !== "MOTN/1.8+QLT1"
      || identityRuntime.pass !== "causal-chronological-single-pass"
      || identityRuntime.harness !== "maxpower-client-single-pass/v2") {
    throw new Error("client prediction runtime identity is invalid");
  }
  const packCases = requireJsonArray(pack.cases, "client test pack cases");
  const expectedProfiles = packCases.map((rawCase) => {
    const testCase = requireJsonRecord(rawCase, "client test case");
    const profile = requireJsonRecord(testCase.profile, "client test profile");
    return {
      captureId: requireJsonString(testCase.captureId, "client test capture id"),
      profileIdentity: requireJsonString(testCase.profileIdentity, "client test profile identity"),
      contentHash: String(profile.contentHash),
    };
  }).sort(profileIdentityOrder);
  const submittedProfiles = requireJsonArray(identity.profiles, "client prediction profiles")
    .map((rawProfile) => {
      const profile = requireJsonRecord(rawProfile, "client prediction profile");
      return {
        captureId: requireJsonString(profile.captureId, "client prediction capture id"),
        profileIdentity: requireJsonString(profile.profileIdentity, "client prediction profile identity"),
        contentHash: requireJsonString(profile.contentHash, "client prediction profile hash"),
      };
    }).sort(profileIdentityOrder);
  if (stableStringify(submittedProfiles) !== stableStringify(expectedProfiles)) {
    throw new Error("client prediction profile identities do not match the frozen pack");
  }
  const runtime = requireJsonRecord(prediction.runtime, "client prediction runtime");
  if (runtime.pythonVisionUsed !== false
      || runtime.packetContract !== "MOTN/1.8+QLT1"
      || runtime.pass !== "causal-chronological-single-pass"
      || stableStringify(runtime.byteIdentity) !== stableStringify(identity)) {
    throw new Error("client prediction runtime provenance is invalid");
  }
  const expectedCaptureIds = expectedProfiles.map((profile) => profile.captureId).sort();
  const cases = requireJsonArray(prediction.cases, "client prediction cases");
  const submittedCaptureIds = cases.map((rawCase) => {
    const testCase = requireJsonRecord(rawCase, "client prediction case");
    const captureId = requireJsonString(testCase.captureId, "client prediction case capture id");
    const assessment = requireJsonRecord(testCase.executionAssessment, "Rust execution assessment");
    if (assessment.owner !== "rust-motion-sdk"
        || assessment.packetContract !== "MOTN/1.8+QLT1"
        || !Array.isArray(assessment.proposals)) {
      throw new Error(`${captureId}: client result is not a Rust QLT1 projection`);
    }
    return captureId;
  }).sort();
  if (stableStringify(submittedCaptureIds) !== stableStringify(expectedCaptureIds)) {
    throw new Error("client prediction cases do not exactly cover the frozen pack");
  }
  return {
    ...prediction,
    boundaries: {
      acceptanceEligible: false,
      originAttestation: "self_reported_local_browser_runtime_not_cryptographic",
      intendedUse: "client_runtime_diagnostic_only",
    },
    serverVerification: {
      packDigestVerified: true,
      predictionIdentityDigestVerified: true,
      pinnedRuntimeIdentityVerified: true,
      exactCaseCoverageVerified: true,
    },
  };
}

function requireJsonArray(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} is invalid`);
  return value;
}

function requireExactJson(actual: unknown, expected: unknown, label: string): void {
  if (stableStringify(actual) !== stableStringify(expected)) throw new Error(`${label} mismatch`);
}

function profileIdentityOrder(
  left: Readonly<{ captureId: string; profileIdentity: string }>,
  right: Readonly<{ captureId: string; profileIdentity: string }>,
): number {
  return left.captureId.localeCompare(right.captureId)
    || left.profileIdentity.localeCompare(right.profileIdentity);
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
