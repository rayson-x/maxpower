export const DOCUMENT_SCHEMA = "maxpower-equipment-video-annotations/v1";
export const MANIFEST_SCHEMA = "maxpower-equipment-video-manifest/v1";
export const TOOL_VERSION = "equipment-video-annotation-lab/v1";

export const TARGETS = new Set([
  "visible_equipment",
  "no_target_equipment",
  "reflection_only",
  "static_rack_only",
  "ambiguous",
]);

export const EQUIPMENT_KINDS = new Set([
  "barbell_shaft",
  "dumbbell",
]);

export function storageKey(video) {
  return `maxpower.equipment-video-annotation.v1:${video.id}`;
}

export function createDocument(video) {
  assertVideo(video);
  return {
    schemaVersion: DOCUMENT_SCHEMA,
    toolVersion: TOOL_VERSION,
    source: sourceIdentity(video),
    annotations: [],
  };
}

export function sourceIdentity(video) {
  assertVideo(video);
  return {
    videoId: video.id,
    assetId: nullableString(video.assetId),
    sourceGroupKey: nullableString(video.sourceGroupKey),
    captureId: nullableString(video.captureId),
    videoSha256: nullableString(video.videoSha256),
    fileName: nullableString(video.fileName),
    exercise: nullableString(video.exercise),
    view: nullableString(video.view),
    admissionState: nullableString(video.admissionState),
  };
}

export function upsertFrameAnnotation(document, input) {
  assertDocument(document);
  const annotation = normalizeAnnotation(input);
  const toleranceMs = Math.max(1, Math.round(500 / annotation.fps));
  const index = document.annotations.findIndex((candidate) => (
    Math.abs(candidate.timestampMs - annotation.timestampMs) <= toleranceMs
  ));
  const annotations = document.annotations.map(clone);
  if (index >= 0) {
    annotation.id = annotations[index].id;
    annotation.createdAt = annotations[index].createdAt;
    annotations[index] = annotation;
  } else {
    annotations.push(annotation);
  }
  annotations.sort((left, right) => left.timestampMs - right.timestampMs || left.id.localeCompare(right.id));
  return { ...clone(document), annotations };
}

export function deleteFrameAnnotation(document, timestampMs, fps) {
  assertDocument(document);
  const safeTimestamp = finiteNumber(timestampMs, "timestampMs");
  const safeFps = positiveNumber(fps, "fps");
  const toleranceMs = Math.max(1, Math.round(500 / safeFps));
  return {
    ...clone(document),
    annotations: document.annotations.filter((annotation) => (
      Math.abs(annotation.timestampMs - safeTimestamp) > toleranceMs
    )).map(clone),
  };
}

export function annotationAt(document, timestampMs, fps) {
  assertDocument(document);
  const safeTimestamp = finiteNumber(timestampMs, "timestampMs");
  const safeFps = positiveNumber(fps, "fps");
  const toleranceMs = Math.max(1, Math.round(500 / safeFps));
  let closest = null;
  for (const annotation of document.annotations) {
    const distance = Math.abs(annotation.timestampMs - safeTimestamp);
    if (distance <= toleranceMs && (!closest || distance < closest.distance)) {
      closest = { distance, annotation };
    }
  }
  return closest ? clone(closest.annotation) : null;
}

export function parseDocument(value, expectedVideo) {
  const parsed = typeof value === "string" ? JSON.parse(value) : clone(value);
  assertDocument(parsed);
  if (expectedVideo && parsed.source.videoId !== expectedVideo.id) {
    throw new Error(`导入文件属于其他视频：${parsed.source.videoId}`);
  }
  return {
    schemaVersion: DOCUMENT_SCHEMA,
    toolVersion: typeof parsed.toolVersion === "string" ? parsed.toolVersion : TOOL_VERSION,
    source: clone(parsed.source),
    annotations: parsed.annotations.map(normalizeAnnotation).sort((left, right) => left.timestampMs - right.timestampMs),
  };
}

export function buildExportBundle(documents, manifest) {
  const safeDocuments = documents.map((document) => parseDocument(document));
  const videoIds = new Set();
  for (const document of safeDocuments) {
    if (videoIds.has(document.source.videoId)) throw new Error(`视频重复：${document.source.videoId}`);
    videoIds.add(document.source.videoId);
  }
  return {
    schemaVersion: "maxpower-equipment-video-annotation-export/v1",
    toolVersion: TOOL_VERSION,
    exportedAt: new Date().toISOString(),
    manifest: {
      schemaVersion: manifest?.schemaVersion ?? null,
      manifestId: manifest?.manifestId ?? null,
      status: manifest?.status ?? null,
    },
    documents: safeDocuments,
  };
}

export function parseExportBundle(value) {
  const parsed = typeof value === "string" ? JSON.parse(value) : clone(value);
  if (!parsed || parsed.schemaVersion !== "maxpower-equipment-video-annotation-export/v1" || !Array.isArray(parsed.documents)) {
    throw new Error("不支持的器械标注导出格式");
  }
  return parsed.documents.map((document) => parseDocument(document));
}

function normalizeAnnotation(input) {
  if (!input || typeof input !== "object") throw new Error("标注必须是对象");
  const target = requiredEnum(input.target, TARGETS, "target");
  const fps = positiveNumber(input.fps, "fps");
  const timestampMs = Math.max(0, Math.round(finiteNumber(input.timestampMs, "timestampMs")));
  const now = new Date().toISOString();
  const instances = target === "visible_equipment"
    ? requireInstances(input.instances)
    : [];
  return {
    id: optionalId(input.id) ?? annotationId(timestampMs),
    timestampMs,
    mediaTimeSeconds: timestampMs / 1000,
    frameIndex: Math.max(0, Math.round(timestampMs * fps / 1000)),
    fps,
    target,
    instances,
    occlusion: requiredEnum(input.occlusion ?? "none", new Set(["none", "partial", "heavy"]), "occlusion"),
    truncated: Boolean(input.truncated),
    note: typeof input.note === "string" ? input.note.slice(0, 2000) : "",
    createdAt: validIso(input.createdAt) ?? now,
    updatedAt: now,
  };
}

function requireInstances(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("可见器械帧至少需要一个轴线或框");
  }
  if (value.length > 8) throw new Error("单帧最多标注 8 个器械实例");
  return value.map((instance, index) => normalizeInstance(instance, index));
}

function normalizeInstance(instance, index) {
  if (!instance || typeof instance !== "object") throw new Error(`器械实例 ${index + 1} 无效`);
  const kind = requiredEnum(instance.kind, EQUIPMENT_KINDS, `instances[${index}].kind`);
  const geometry = instance.geometry;
  if (!geometry || typeof geometry !== "object") throw new Error(`器械实例 ${index + 1} 缺少几何标注`);
  if (geometry.type === "axis") {
    if (kind !== "barbell_shaft") throw new Error("轴线几何只适用于 barbell_shaft");
    return {
      id: optionalId(instance.id) ?? `instance-${index + 1}`,
      kind,
      geometry: {
        type: "axis",
        a: point(geometry.a, `instances[${index}].geometry.a`),
        b: point(geometry.b, `instances[${index}].geometry.b`),
        coordinateSpace: "normalized_video",
      },
    };
  }
  if (geometry.type === "bbox") {
    const x = normalized(geometry.x, `instances[${index}].geometry.x`);
    const y = normalized(geometry.y, `instances[${index}].geometry.y`);
    const width = normalized(geometry.width, `instances[${index}].geometry.width`);
    const height = normalized(geometry.height, `instances[${index}].geometry.height`);
    if (width <= 0 || height <= 0 || x + width > 1.000001 || y + height > 1.000001) {
      throw new Error(`器械实例 ${index + 1} 的 bbox 越界或为空`);
    }
    return {
      id: optionalId(instance.id) ?? `instance-${index + 1}`,
      kind,
      geometry: { type: "bbox", x, y, width, height, coordinateSpace: "normalized_video" },
    };
  }
  throw new Error(`器械实例 ${index + 1} 的几何类型不支持`);
}

function point(value, label) {
  if (!value || typeof value !== "object") throw new Error(`${label} 无效`);
  return { x: normalized(value.x, `${label}.x`), y: normalized(value.y, `${label}.y`) };
}

function assertDocument(document) {
  if (!document || document.schemaVersion !== DOCUMENT_SCHEMA || !document.source || !Array.isArray(document.annotations)) {
    throw new Error("不支持的器械视频标注文档");
  }
  if (typeof document.source.videoId !== "string" || document.source.videoId.length === 0) {
    throw new Error("标注文档缺少视频身份");
  }
}

function assertVideo(video) {
  if (!video || typeof video.id !== "string" || video.id.length === 0) throw new Error("视频缺少稳定 ID");
}

function requiredEnum(value, allowed, label) {
  if (typeof value !== "string" || !allowed.has(value)) throw new Error(`${label} 不支持：${String(value)}`);
  return value;
}

function normalized(value, label) {
  const number = finiteNumber(value, label);
  if (number < 0 || number > 1) throw new Error(`${label} 必须在 0 到 1 之间`);
  return number;
}

function finiteNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} 必须是有限数值`);
  return value;
}

function positiveNumber(value, label) {
  const number = finiteNumber(value, label);
  if (number <= 0 || number > 240) throw new Error(`${label} 必须大于 0 且不超过 240`);
  return number;
}

function optionalId(value) {
  return typeof value === "string" && /^[a-zA-Z0-9._:-]{1,160}$/u.test(value) ? value : null;
}

function nullableString(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function validIso(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
}

function annotationId(timestampMs) {
  return `frame-${timestampMs}-${Math.random().toString(36).slice(2, 9)}`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
