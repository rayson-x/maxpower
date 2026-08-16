import {
  annotationAt,
  buildExportBundle,
  createDocument,
  deleteFrameAnnotation,
  parseDocument,
  parseExportBundle,
  storageKey,
  upsertFrameAnnotation,
} from "./annotationDocument.mjs";

const $ = (id) => document.getElementById(id);
const dom = Object.fromEntries([
  "headline-stats", "manifest-state", "search", "exercise-filter", "view-filter", "local-video-input",
  "video-count", "video-list", "stage", "video", "overlay", "action-chip", "frame-chip", "stage-empty",
  "timeline", "rep-bands", "annotation-marks", "previous-frame", "play", "next-frame", "current-time",
  "duration", "fps", "case-title", "case-lineage", "target-grid", "equipment-tabs", "axis-tool", "box-tool",
  "undo-instance", "drawing-note", "instance-list", "occlusion", "truncated", "note", "flash", "delete-frame",
  "save-frame", "import-json", "export-json", "json-input",
].map((id) => [id, $(id)]));

const canvas = dom.overlay;
const context = canvas.getContext("2d");
const localObjectUrls = new Map();
const state = {
  manifest: null,
  videos: [],
  selectedVideo: null,
  document: null,
  search: "",
  exercise: "all",
  view: "all",
  target: "visible_equipment",
  equipmentKind: "barbell_shaft",
  tool: "axis",
  instances: [],
  occlusion: "none",
  truncated: false,
  note: "",
  pointer: null,
  previewGeometry: null,
};

boot().catch(fatal);

async function boot() {
  const response = await fetch("/api/manifest");
  if (!response.ok) throw new Error("视频清单读取失败");
  state.manifest = await response.json();
  state.videos = state.manifest.videos ?? [];
  bindEvents();
  renderManifest();
  refreshFilters();
  renderVideoList();
  renderHeadline();
  renderEditor();
  resizeCanvas();
}

function bindEvents() {
  dom.search.addEventListener("input", () => { state.search = dom.search.value.trim().toLowerCase(); renderVideoList(); });
  dom["exercise-filter"].addEventListener("change", () => { state.exercise = dom["exercise-filter"].value; renderVideoList(); });
  dom["view-filter"].addEventListener("change", () => { state.view = dom["view-filter"].value; renderVideoList(); });
  dom["video-list"].addEventListener("click", (event) => {
    const card = event.target.closest("[data-video-id]");
    if (card) void selectVideo(card.dataset.videoId);
  });
  dom["local-video-input"].addEventListener("change", () => addLocalVideos([...dom["local-video-input"].files]));
  dom.play.addEventListener("click", togglePlayback);
  dom["previous-frame"].addEventListener("click", () => stepFrame(-1));
  dom["next-frame"].addEventListener("click", () => stepFrame(1));
  dom.timeline.addEventListener("input", () => seekTo(Number(dom.timeline.value) / 1000));
  dom.fps.addEventListener("change", () => {
    dom.fps.value = String(safeFps());
    syncDraftFromFrame();
    renderTransport();
  });
  dom.video.addEventListener("loadedmetadata", () => {
    dom.timeline.max = String(Math.max(1, Math.round(dom.video.duration * 1000)));
    dom.duration.textContent = timecode(dom.video.duration);
    dom["stage-empty"].hidden = true;
    resizeCanvas();
    renderRepBands();
    renderTransport();
    syncDraftFromFrame();
  });
  dom.video.addEventListener("timeupdate", renderTransport);
  dom.video.addEventListener("seeked", () => { syncDraftFromFrame(); renderTransport(); });
  dom.video.addEventListener("play", () => { dom.play.textContent = "PAUSE"; clearUnsavedGeometry(); });
  dom.video.addEventListener("pause", () => { dom.play.textContent = "PLAY"; syncDraftFromFrame(); });
  dom.video.addEventListener("ended", () => { dom.play.textContent = "PLAY"; });
  dom["target-grid"].addEventListener("click", (event) => {
    const button = event.target.closest("[data-target]");
    if (!button) return;
    state.target = button.dataset.target;
    if (state.target !== "visible_equipment") state.instances = [];
    renderEditor();
    renderCanvas();
  });
  dom["equipment-tabs"].addEventListener("click", (event) => {
    const button = event.target.closest("[data-kind]");
    if (!button) return;
    state.equipmentKind = button.dataset.kind;
    state.tool = state.equipmentKind === "barbell_shaft" ? "axis" : "bbox";
    renderEditor();
  });
  dom["axis-tool"].addEventListener("click", () => setTool("axis"));
  dom["box-tool"].addEventListener("click", () => setTool("bbox"));
  dom["undo-instance"].addEventListener("click", () => {
    state.instances.pop();
    renderEditor();
    renderCanvas();
  });
  dom["instance-list"].addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-instance]");
    if (!button) return;
    state.instances.splice(Number(button.dataset.removeInstance), 1);
    renderEditor();
    renderCanvas();
  });
  dom.occlusion.addEventListener("change", () => { state.occlusion = dom.occlusion.value; });
  dom.truncated.addEventListener("change", () => { state.truncated = dom.truncated.checked; });
  dom.note.addEventListener("input", () => { state.note = dom.note.value; });
  dom["save-frame"].addEventListener("click", saveFrame);
  dom["delete-frame"].addEventListener("click", deleteFrame);
  dom["export-json"].addEventListener("click", exportAll);
  dom["import-json"].addEventListener("click", () => dom["json-input"].click());
  dom["json-input"].addEventListener("change", importJson);
  canvas.addEventListener("pointerdown", pointerDown);
  canvas.addEventListener("pointermove", pointerMove);
  canvas.addEventListener("pointerup", pointerUp);
  canvas.addEventListener("pointercancel", cancelPointer);
  window.addEventListener("resize", resizeCanvas);
  window.addEventListener("keydown", keyboardShortcut);
}

function addLocalVideos(files) {
  for (const file of files) {
    const id = `local-${stableLocalId(file)}`;
    if (state.videos.some((video) => video.id === id)) continue;
    const videoUrl = URL.createObjectURL(file);
    localObjectUrls.set(id, videoUrl);
    state.videos.push({
      id,
      title: file.name,
      fileName: file.name,
      exercise: "unassigned",
      view: "unassigned",
      admissionState: "unregistered_local_file",
      videoUrl,
      sourceKind: "local_file",
    });
  }
  dom["local-video-input"].value = "";
  refreshFilters();
  renderVideoList();
  renderHeadline();
  if (!state.selectedVideo && state.videos.length) void selectVideo(state.videos.at(-1).id);
}

async function selectVideo(id) {
  const video = state.videos.find((candidate) => candidate.id === id);
  if (!video) return;
  state.selectedVideo = video;
  state.document = loadDocument(video);
  resetDraft();
  dom.video.pause();
  dom.video.src = video.videoUrl;
  dom.video.load();
  renderVideoList();
  renderHeadline();
  renderEditor();
  renderAnnotationMarks();
  flash("视频已载入。暂停到目标帧后开始标注。", "ok");
}

function loadDocument(video) {
  const stored = localStorage.getItem(storageKey(video));
  if (!stored) return createDocument(video);
  try {
    return parseDocument(stored, video);
  } catch (error) {
    flash(`本地草稿无效，已忽略：${error.message}`, "error");
    return createDocument(video);
  }
}

function saveFrame() {
  if (!state.selectedVideo || !state.document) return flash("请先选择视频。", "error");
  if (!dom.video.paused) return flash("请先暂停视频，再确认当前帧。", "error");
  try {
    state.occlusion = dom.occlusion.value;
    state.truncated = dom.truncated.checked;
    state.note = dom.note.value;
    state.document = upsertFrameAnnotation(state.document, {
      timestampMs: currentTimestampMs(),
      fps: safeFps(),
      target: state.target,
      instances: state.instances,
      occlusion: state.occlusion,
      truncated: state.truncated,
      note: state.note,
    });
    persistCurrentDocument();
    syncDraftFromFrame();
    renderVideoList();
    renderHeadline();
    renderAnnotationMarks();
    flash(`已保存 ${timecode(dom.video.currentTime)} 的人工标注。`, "ok");
  } catch (error) {
    flash(error.message, "error");
  }
}

function deleteFrame() {
  if (!state.document || !state.selectedVideo) return;
  state.document = deleteFrameAnnotation(state.document, currentTimestampMs(), safeFps());
  persistCurrentDocument();
  resetDraft();
  renderEditor();
  renderCanvas();
  renderVideoList();
  renderHeadline();
  renderAnnotationMarks();
  flash("当前时间点的标注已从浏览器草稿删除。", "ok");
}

function persistCurrentDocument() {
  try {
    localStorage.setItem(storageKey(state.selectedVideo), JSON.stringify(state.document));
  } catch (error) {
    throw new Error(`localStorage 写入失败：${error.message}`);
  }
}

function exportAll() {
  try {
    const documents = [];
    for (const video of state.videos) {
      const raw = video.id === state.selectedVideo?.id
        ? JSON.stringify(state.document)
        : localStorage.getItem(storageKey(video));
      if (!raw) continue;
      const document = parseDocument(raw, video);
      if (document.annotations.length) documents.push(document);
    }
    if (!documents.length) return flash("当前没有可导出的标注。", "error");
    const bundle = buildExportBundle(documents, state.manifest);
    const blob = new Blob([`${JSON.stringify(bundle, null, 2)}\n`], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `maxpower-equipment-annotations-${new Date().toISOString().replaceAll(":", "-")}.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    flash(`已导出 ${documents.length} 个视频的标注 JSON。`, "ok");
  } catch (error) {
    flash(error.message, "error");
  }
}

async function importJson() {
  const file = dom["json-input"].files?.[0];
  dom["json-input"].value = "";
  if (!file) return;
  try {
    const documents = parseExportBundle(await file.text());
    let imported = 0;
    for (const importedDocument of documents) {
      const video = state.videos.find((candidate) => candidate.id === importedDocument.source.videoId);
      if (!video) continue;
      localStorage.setItem(storageKey(video), JSON.stringify(parseDocument(importedDocument, video)));
      if (state.selectedVideo?.id === video.id) state.document = parseDocument(importedDocument, video);
      imported += 1;
    }
    syncDraftFromFrame();
    renderVideoList();
    renderHeadline();
    renderAnnotationMarks();
    flash(`已恢复 ${imported}/${documents.length} 个当前清单内的视频草稿。`, imported ? "ok" : "error");
  } catch (error) {
    flash(`导入失败：${error.message}`, "error");
  }
}

function syncDraftFromFrame() {
  if (!state.document || !dom.video.paused) return;
  const current = annotationAt(state.document, currentTimestampMs(), safeFps());
  if (!current) {
    resetDraft();
  } else {
    state.target = current.target;
    state.instances = structuredClone(current.instances);
    state.occlusion = current.occlusion;
    state.truncated = current.truncated;
    state.note = current.note;
  }
  renderEditor();
  renderCanvas();
}

function resetDraft() {
  state.target = "visible_equipment";
  state.instances = [];
  state.occlusion = "none";
  state.truncated = false;
  state.note = "";
  state.previewGeometry = null;
  state.pointer = null;
}

function clearUnsavedGeometry() {
  state.previewGeometry = null;
  state.pointer = null;
  renderCanvas();
}

function setTool(tool) {
  state.tool = tool;
  if (tool === "axis") state.equipmentKind = "barbell_shaft";
  renderEditor();
}

function pointerDown(event) {
  if (!state.selectedVideo || !dom.video.paused || state.target !== "visible_equipment") {
    return flash("请先选择视频、暂停，并选择“真实器械可见”。", "error");
  }
  const point = pointerToNormalized(event);
  if (!point) return;
  canvas.setPointerCapture(event.pointerId);
  state.pointer = { id: event.pointerId, start: point };
  state.previewGeometry = geometryFromDrag(point, point);
  renderCanvas();
}

function pointerMove(event) {
  if (!state.pointer || state.pointer.id !== event.pointerId) return;
  const point = pointerToNormalized(event);
  if (!point) return;
  state.previewGeometry = geometryFromDrag(state.pointer.start, point);
  renderCanvas();
}

function pointerUp(event) {
  if (!state.pointer || state.pointer.id !== event.pointerId) return;
  const point = pointerToNormalized(event);
  if (point) state.previewGeometry = geometryFromDrag(state.pointer.start, point);
  const geometry = state.previewGeometry;
  state.pointer = null;
  state.previewGeometry = null;
  if (!geometry || geometryTooSmall(geometry)) {
    renderCanvas();
    return flash("标注范围太小，请重新拖动。", "error");
  }
  const instance = { id: `draft-${Date.now()}`, kind: state.equipmentKind, geometry };
  if (state.tool === "axis") {
    state.instances = [...state.instances.filter((candidate) => candidate.kind !== "barbell_shaft"), instance];
  } else if (state.instances.length < 8) {
    state.instances.push(instance);
  }
  renderEditor();
  renderCanvas();
  flash("几何已加入当前帧草稿；点击保存后才会写入 localStorage。", "ok");
}

function cancelPointer() {
  state.pointer = null;
  state.previewGeometry = null;
  renderCanvas();
}

function geometryFromDrag(start, end) {
  if (state.tool === "axis") {
    return { type: "axis", a: start, b: end, coordinateSpace: "normalized_video" };
  }
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  return {
    type: "bbox",
    x,
    y,
    width: Math.abs(start.x - end.x),
    height: Math.abs(start.y - end.y),
    coordinateSpace: "normalized_video",
  };
}

function geometryTooSmall(geometry) {
  if (geometry.type === "axis") return Math.hypot(geometry.a.x - geometry.b.x, geometry.a.y - geometry.b.y) < 0.015;
  return geometry.width < 0.006 || geometry.height < 0.006;
}

function pointerToNormalized(event) {
  const rect = canvas.getBoundingClientRect();
  const videoRect = displayedVideoRect(rect.width, rect.height);
  if (!videoRect) return null;
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  if (x < videoRect.left || x > videoRect.left + videoRect.width || y < videoRect.top || y > videoRect.top + videoRect.height) return null;
  return {
    x: clamp((x - videoRect.left) / videoRect.width, 0, 1),
    y: clamp((y - videoRect.top) / videoRect.height, 0, 1),
  };
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
  renderCanvas();
}

function renderCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, rect.width, rect.height);
  const videoRect = displayedVideoRect(rect.width, rect.height);
  if (!videoRect) return;
  state.instances.forEach((instance, index) => drawGeometry(instance.geometry, videoRect, index, false));
  if (state.previewGeometry) drawGeometry(state.previewGeometry, videoRect, state.instances.length, true);
}

function drawGeometry(geometry, rect, index, preview) {
  const color = preview ? "#ff6b3d" : "#d9ff43";
  context.save();
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = preview ? 2 : 2.5;
  context.setLineDash(preview ? [7, 5] : []);
  context.shadowColor = "rgba(0,0,0,.65)";
  context.shadowBlur = 5;
  if (geometry.type === "axis") {
    const a = toCanvasPoint(geometry.a, rect);
    const b = toCanvasPoint(geometry.b, rect);
    context.beginPath();
    context.moveTo(a.x, a.y);
    context.lineTo(b.x, b.y);
    context.stroke();
    context.setLineDash([]);
    for (const point of [a, b]) {
      context.beginPath();
      context.arc(point.x, point.y, 5, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = "#080b09";
      context.lineWidth = 2;
      context.stroke();
    }
    drawIndex(index, (a.x + b.x) / 2, (a.y + b.y) / 2);
  } else {
    const x = rect.left + geometry.x * rect.width;
    const y = rect.top + geometry.y * rect.height;
    const width = geometry.width * rect.width;
    const height = geometry.height * rect.height;
    context.strokeRect(x, y, width, height);
    drawIndex(index, x + 10, y + 10);
  }
  context.restore();
}

function drawIndex(index, x, y) {
  context.setLineDash([]);
  context.shadowBlur = 0;
  context.fillStyle = "#d9ff43";
  context.fillRect(x - 9, y - 9, 18, 18);
  context.fillStyle = "#090b0a";
  context.font = "800 9px SFMono-Regular, Menlo, monospace";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(String(index + 1), x, y + .5);
}

function displayedVideoRect(width, height) {
  if (!dom.video.videoWidth || !dom.video.videoHeight) return null;
  const scale = Math.min(width / dom.video.videoWidth, height / dom.video.videoHeight);
  const renderedWidth = dom.video.videoWidth * scale;
  const renderedHeight = dom.video.videoHeight * scale;
  return { left: (width - renderedWidth) / 2, top: (height - renderedHeight) / 2, width: renderedWidth, height: renderedHeight };
}

function toCanvasPoint(point, rect) {
  return { x: rect.left + point.x * rect.width, y: rect.top + point.y * rect.height };
}

function togglePlayback() {
  if (!state.selectedVideo) return;
  if (dom.video.paused) void dom.video.play();
  else dom.video.pause();
}

function stepFrame(direction) {
  if (!state.selectedVideo) return;
  dom.video.pause();
  seekTo(dom.video.currentTime + direction / safeFps());
}

function seekTo(seconds) {
  if (!state.selectedVideo || !Number.isFinite(dom.video.duration)) return;
  dom.video.currentTime = clamp(seconds, 0, dom.video.duration);
}

function renderTransport() {
  const timestampMs = currentTimestampMs();
  const durationMs = Number.isFinite(dom.video.duration) ? Math.round(dom.video.duration * 1000) : 0;
  dom.timeline.value = String(timestampMs);
  dom.timeline.style.setProperty("--progress", durationMs ? `${timestampMs / durationMs * 100}%` : "0%");
  dom["current-time"].textContent = timecode(dom.video.currentTime || 0);
  dom.duration.textContent = timecode(dom.video.duration || 0);
  dom["frame-chip"].textContent = `${timecode(dom.video.currentTime || 0)} · F${String(Math.round((dom.video.currentTime || 0) * safeFps())).padStart(5, "0")}`;
}

function renderRepBands() {
  const ranges = state.selectedVideo?.repRanges ?? [];
  const durationMs = (dom.video.duration || 0) * 1000;
  dom["rep-bands"].innerHTML = durationMs ? ranges.map((range) => {
    const start = clamp(Number(range.startMs) / durationMs * 100, 0, 100);
    const end = clamp(Number(range.endMs) / durationMs * 100, start, 100);
    return `<i class="rep-band" style="left:${start}%;width:${Math.max(.15, end - start)}%"></i>`;
  }).join("") : "";
}

function renderAnnotationMarks() {
  const durationMs = (dom.video.duration || 0) * 1000;
  dom["annotation-marks"].innerHTML = durationMs && state.document
    ? state.document.annotations.map((annotation) => `<i class="annotation-mark" style="left:${clamp(annotation.timestampMs / durationMs * 100, 0, 100)}%"></i>`).join("")
    : "";
}

function renderManifest() {
  const blocked = state.manifest.status !== "ready";
  dom["manifest-state"].className = `manifest-state${blocked ? " blocked" : ""}`;
  dom["manifest-state"].innerHTML = blocked
    ? `<strong>MANIFEST BLOCKED</strong>${escapeHtml((state.manifest.blockers ?? ["视频清单尚未生成。"]).join(" "))}`
    : `<strong>GOVERNED MANIFEST READY</strong>${escapeHtml(state.manifest.manifestId)} · ${state.manifest.videos.length} 个可选来源`;
}

function refreshFilters() {
  fillSelect(dom["exercise-filter"], "全部动作", unique(state.videos.map((video) => video.exercise).filter(Boolean)), state.exercise);
  fillSelect(dom["view-filter"], "全部机位", unique(state.videos.map((video) => video.view).filter(Boolean)), state.view);
}

function fillSelect(select, allLabel, values, selected) {
  select.innerHTML = `<option value="all">${escapeHtml(allLabel)}</option>${values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("")}`;
  select.value = values.includes(selected) ? selected : "all";
}

function renderVideoList() {
  const videos = filteredVideos();
  dom["video-count"].textContent = String(videos.length);
  dom["video-list"].innerHTML = videos.length ? videos.map((video, index) => {
    const count = annotationCount(video);
    const meta = [video.exercise, video.view, video.sourceKind === "local_file" ? "LOCAL" : video.admissionState].filter(Boolean).join(" · ");
    return `<button class="video-card ${video.id === state.selectedVideo?.id ? "active" : ""} ${count ? "has-labels" : ""}" data-video-id="${escapeHtml(video.id)}" style="--i:${index}">
      <span class="video-glyph">${count ? "✓" : "○"}</span>
      <span><span class="video-name">${escapeHtml(video.title ?? video.captureId ?? video.id)}</span><span class="video-meta">${escapeHtml(meta || "UNASSIGNED")}</span></span>
      <span class="label-count">${count}<small> FR</small></span>
    </button>`;
  }).join("") : `<div class="empty">当前筛选没有视频。数据审计阻塞时，可先临时打开本地视频验证交互。</div>`;
}

function renderHeadline() {
  const totalAnnotations = state.videos.reduce((sum, video) => sum + annotationCount(video), 0);
  const labeledVideos = state.videos.filter((video) => annotationCount(video) > 0).length;
  dom["headline-stats"].innerHTML = [
    [state.videos.length, "视频来源", ""],
    [labeledVideos, "已有草稿", "acid"],
    [totalAnnotations, "标注帧", "acid"],
  ].map(([value, label, className]) => `<div class="headline-stat ${className}"><strong>${value}</strong><span>${label}</span></div>`).join("");
}

function renderEditor() {
  const hasVideo = Boolean(state.selectedVideo);
  dom["case-title"].textContent = hasVideo ? (state.selectedVideo.title ?? state.selectedVideo.captureId ?? state.selectedVideo.id) : "尚未选择视频";
  dom["case-lineage"].textContent = hasVideo
    ? [state.selectedVideo.assetId, state.selectedVideo.captureId, state.selectedVideo.exercise, state.selectedVideo.view].filter(Boolean).join(" · ") || state.selectedVideo.admissionState
    : "选择视频后开始逐帧标注。";
  dom["action-chip"].textContent = hasVideo ? `${state.selectedVideo.exercise ?? "UNASSIGNED"} / ${state.selectedVideo.view ?? "UNASSIGNED"}` : "NO VIDEO";
  for (const button of dom["target-grid"].querySelectorAll("[data-target]")) button.classList.toggle("active", button.dataset.target === state.target);
  for (const button of dom["equipment-tabs"].querySelectorAll("[data-kind]")) button.classList.toggle("active", button.dataset.kind === state.equipmentKind);
  dom["axis-tool"].classList.toggle("active", state.tool === "axis");
  dom["box-tool"].classList.toggle("active", state.tool === "bbox");
  dom["drawing-note"].textContent = state.tool === "axis"
    ? "在暂停画面上，从杠铃杆一个可见端点拖到另一个端点；重新画轴线会替换本帧旧轴线。"
    : "在暂停画面上拖出紧贴器械的矩形；可连续添加多个哑铃实例。";
  dom["instance-list"].innerHTML = state.instances.length ? state.instances.map((instance, index) => {
    const geometry = instance.geometry.type === "axis"
      ? `A ${percent(instance.geometry.a.x)},${percent(instance.geometry.a.y)} → B ${percent(instance.geometry.b.x)},${percent(instance.geometry.b.y)}`
      : `X ${percent(instance.geometry.x)} · Y ${percent(instance.geometry.y)} · W ${percent(instance.geometry.width)} · H ${percent(instance.geometry.height)}`;
    return `<div class="instance"><span class="instance-index">${index + 1}</span><span><strong>${escapeHtml(instance.kind)}</strong><span>${escapeHtml(geometry)}</span></span><button data-remove-instance="${index}" aria-label="删除实例">×</button></div>`;
  }).join("") : `<div class="empty small">当前帧还没有几何标注。</div>`;
  dom.occlusion.value = state.occlusion;
  dom.truncated.checked = state.truncated;
  dom.note.value = state.note;
  for (const element of [dom["save-frame"], dom["delete-frame"], dom["axis-tool"], dom["box-tool"], dom["undo-instance"]]) element.disabled = !hasVideo;
}

function filteredVideos() {
  return state.videos.filter((video) => {
    if (state.exercise !== "all" && video.exercise !== state.exercise) return false;
    if (state.view !== "all" && video.view !== state.view) return false;
    if (!state.search) return true;
    return [video.title, video.id, video.captureId, video.exercise, video.view].some((value) => String(value ?? "").toLowerCase().includes(state.search));
  });
}

function annotationCount(video) {
  if (video.id === state.selectedVideo?.id && state.document) return state.document.annotations.length;
  const raw = localStorage.getItem(storageKey(video));
  if (!raw) return 0;
  try { return parseDocument(raw, video).annotations.length; } catch { return 0; }
}

function keyboardShortcut(event) {
  if (event.target.matches("input, textarea, select")) return;
  if (event.code === "Space") { event.preventDefault(); togglePlayback(); }
  else if (event.key === "[") stepFrame(-1);
  else if (event.key === "]") stepFrame(1);
  else if (event.key.toLowerCase() === "a") setTool("axis");
  else if (event.key.toLowerCase() === "b") setTool("bbox");
  else if (["1", "2", "3", "4", "5"].includes(event.key)) {
    const targets = ["visible_equipment", "no_target_equipment", "reflection_only", "static_rack_only", "ambiguous"];
    state.target = targets[Number(event.key) - 1];
    if (state.target !== "visible_equipment") state.instances = [];
    renderEditor();
    renderCanvas();
  } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    saveFrame();
  }
}

function flash(message, kind = "") {
  dom.flash.textContent = message;
  dom.flash.className = `flash ${kind}`;
}

function fatal(error) {
  console.error(error);
  if (dom.flash) flash(error.message ?? String(error), "error");
  if (dom["video-list"]) dom["video-list"].innerHTML = `<div class="empty">${escapeHtml(error.message ?? String(error))}</div>`;
}

function safeFps() {
  const value = Number(dom.fps.value);
  return Number.isFinite(value) && value > 0 && value <= 240 ? value : 30;
}

function currentTimestampMs() {
  return Math.max(0, Math.round((dom.video.currentTime || 0) * 1000));
}

function timecode(seconds) {
  const safe = Number.isFinite(seconds) && seconds >= 0 ? seconds : 0;
  const minutes = Math.floor(safe / 60);
  const remaining = safe - minutes * 60;
  return `${String(minutes).padStart(2, "0")}:${remaining.toFixed(3).padStart(6, "0")}`;
}

function stableLocalId(file) {
  let hash = 2166136261;
  const value = `${file.name}:${file.size}:${file.lastModified}`;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function unique(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function percent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/gu, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}
