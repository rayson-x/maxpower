(function attachV7AlignmentReview(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.V7AlignmentReviewApp = api;
  if (typeof document === "object") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", api.mount);
    else api.mount();
  }
})(typeof globalThis === "object" ? globalThis : this, function createV7AlignmentReview() {
  "use strict";

  const REPORT_SCHEMAS = new Set([
    "maxpower-current-rust-known-video-alignment/v1",
    "maxpower-current-rust-equipment-fused-known-video-alignment/v1",
  ]);
  const HALPE26_EDGES = [
    [0, 1], [0, 2], [1, 3], [2, 4],
    [5, 7], [7, 9], [6, 8], [8, 10], [5, 6], [5, 11], [6, 12], [11, 12],
    [11, 13], [13, 15], [12, 14], [14, 16],
    [17, 18], [18, 5], [18, 6], [18, 19], [19, 11], [19, 12],
    [15, 20], [15, 22], [15, 24], [20, 22], [16, 21], [16, 23], [16, 25], [21, 23],
  ];
  const SPEEDS = [0.5, 1, 1.5, 2];

  function normalizeReport(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("v7 对齐报告无效");
    if (!REPORT_SCHEMAS.has(raw.schemaVersion)) throw new Error("不支持的 Rust 对齐报告版本");
    if (!Array.isArray(raw.rows) || !raw.rows.length) throw new Error("v7 对齐报告没有记录");
    const seen = new Set();
    const rows = raw.rows.map((rawRow, index) => {
      if (!rawRow || typeof rawRow !== "object" || Array.isArray(rawRow)) throw new Error(`第 ${index + 1} 条记录无效`);
      const contextId = requireString(rawRow.contextId, "contextId");
      if (seen.has(contextId)) throw new Error(`重复 contextId: ${contextId}`);
      seen.add(contextId);
      const truthRanges = normalizeRanges(rawRow.truthRanges, "人工区间");
      const phaseOrder = normalizePhaseOrder(rawRow.phaseOrder);
      const predictedReps = Array.isArray(rawRow.predictedReps)
        ? rawRow.predictedReps.map((rep, repIndex) => {
          const turnaroundSource = String(rep.turnaroundSource || "pose_primary");
          if (!new Set(["pose_primary", "equipment_fused"]).has(turnaroundSource)) {
            throw new Error(`预测 Rep ${repIndex + 1} 换向来源无效`);
          }
          return {
            ...rep,
            repId: Number(rep.repId),
            startMs: finite(rep.startMs, `预测 Rep ${repIndex + 1} startMs`),
            endMs: finite(rep.endMs, `预测 Rep ${repIndex + 1} endMs`),
            turnaroundMs: finite(rep.turnaroundMs, `预测 Rep ${repIndex + 1} turnaroundMs`),
            turnaroundSource,
            disposition: requireString(rep.disposition, "预测 disposition"),
          };
        })
        : [];
      const matches = Array.isArray(rawRow.matches) ? rawRow.matches.map((match) => ({
        ...match,
        truthIndex: finite(match.truthIndex, "truthIndex"),
        predictedIndex: finite(match.predictedIndex, "predictedIndex"),
        startErrorMs: finite(match.startErrorMs, "startErrorMs"),
        endErrorMs: finite(match.endErrorMs, "endErrorMs"),
        intervalIou: finite(match.intervalIou, "intervalIou"),
        strictBoundaryAligned: Boolean(match.strictBoundaryAligned),
      })) : [];
      const equipmentProvider = normalizeEquipmentProvider(rawRow.equipmentProvider);
      return Object.freeze({
        ...rawRow,
        contextId,
        sourceCaptureId: requireString(rawRow.sourceCaptureId, "sourceCaptureId"),
        exerciseId: requireString(rawRow.exerciseId, "exerciseId"),
        capturePosition: requireString(rawRow.capturePosition, "capturePosition"),
        videoUrl: requireString(rawRow.videoUrl, "videoUrl"),
        poseUrl: requireString(rawRow.poseUrl, "poseUrl"),
        durationMs: Number(rawRow.durationMs) || Math.max(
          ...truthRanges.map((range) => range.endMs),
          ...predictedReps.map((rep) => rep.endMs),
          1,
        ),
        truthRanges,
        phaseOrder,
        predictedReps,
        matches,
        equipmentProvider,
        qualityFindingStates: Array.isArray(rawRow.qualityFindingStates)
          ? rawRow.qualityFindingStates.map(String)
          : [],
      });
    });
    return Object.freeze({ ...raw, rows: Object.freeze(rows) });
  }

  function normalizeEquipmentProvider(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return Object.freeze({ recognitionMode: "Unavailable", frames: Object.freeze([]) });
    }
    let previousFrameNumber = -1;
    let previousTimestamp = -1;
    const frames = Array.isArray(raw.frames) ? raw.frames.map((frame, index) => {
      const frameNumber = finite(frame?.frameNumber, `器械帧 ${index + 1} frameNumber`);
      const timestampMs = finite(frame?.timestampMs, `器械帧 ${index + 1} timestampMs`);
      if (frameNumber <= previousFrameNumber || timestampMs <= previousTimestamp) {
        throw new Error("器械轨迹时间顺序无效");
      }
      previousFrameNumber = frameNumber;
      previousTimestamp = timestampMs;
      const source = requireString(frame?.source, `器械帧 ${index + 1} source`);
      if (!["Measured", "Predicted", "Fused"].includes(source)) throw new Error("器械轨迹来源无效");
      return Object.freeze({
        frameNumber,
        timestampMs,
        source,
        confidence: finite(frame.confidence, `器械帧 ${index + 1} confidence`),
        uncertaintyPx: finite(frame.uncertaintyPx, `器械帧 ${index + 1} uncertaintyPx`),
        x1: finite(frame.x1, `器械帧 ${index + 1} x1`),
        y1: finite(frame.y1, `器械帧 ${index + 1} y1`),
        x2: finite(frame.x2, `器械帧 ${index + 1} x2`),
        y2: finite(frame.y2, `器械帧 ${index + 1} y2`),
        centerY: finite(frame.centerY, `器械帧 ${index + 1} centerY`),
      });
    }) : [];
    const trackerOutputFrameCount = finite(
      raw.trackerOutputFrameCount ?? frames.length,
      "equipment trackerOutputFrameCount",
    );
    if (trackerOutputFrameCount !== frames.length) throw new Error("器械轨迹帧计数无效");
    return Object.freeze({
      ...raw,
      recognitionMode: requireString(raw.recognitionMode || "Unavailable", "equipment recognitionMode"),
      trackerOutputFrameCount,
      frames: Object.freeze(frames),
    });
  }

  function normalizePhaseOrder(value) {
    if (!Array.isArray(value) || value.length !== 2
      || value.some((phase) => phase !== "concentric" && phase !== "eccentric")) {
      throw new Error("v7 动作契约没有有效的 phaseOrder");
    }
    return Object.freeze([value[0], value[1]]);
  }

  function phaseAt(rep, phaseOrder, timestampMs) {
    if (!rep || timestampMs < rep.startMs || timestampMs > rep.endMs) return null;
    const index = timestampMs <= rep.turnaroundMs ? 0 : 1;
    return Object.freeze({ index, phase: phaseOrder[index] });
  }

  function normalizeRanges(rawRanges, label) {
    if (!Array.isArray(rawRanges)) throw new Error(`${label}无效`);
    let previousStart = -1;
    return rawRanges.map((range, index) => {
      const startMs = finite(range?.startMs, `${label} ${index + 1} startMs`);
      const endMs = finite(range?.endMs, `${label} ${index + 1} endMs`);
      if (startMs < previousStart || endMs <= startMs) throw new Error(`${label}顺序无效`);
      previousStart = startMs;
      return Object.freeze({ startMs, endMs });
    });
  }

  function frameAt(frames, timestampMs, maximumAgeMs = 180) {
    if (!Array.isArray(frames) || !frames.length) return null;
    let low = 0;
    let high = frames.length - 1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      if (Number(frames[middle].timestampMs) <= timestampMs) low = middle + 1;
      else high = middle - 1;
    }
    const candidates = [frames[Math.max(0, high)], frames[Math.min(frames.length - 1, low)]].filter(Boolean);
    const nearest = candidates.reduce((best, candidate) => (
      Math.abs(Number(candidate.timestampMs) - timestampMs) < Math.abs(Number(best.timestampMs) - timestampMs)
        ? candidate : best
    ));
    return Math.abs(Number(nearest.timestampMs) - timestampMs) <= maximumAgeMs ? nearest : null;
  }

  function rangeAt(ranges, timestampMs) {
    const index = ranges.findIndex((range) => timestampMs >= range.startMs && timestampMs <= range.endMs);
    return index < 0 ? null : Object.freeze({ index, range: ranges[index] });
  }

  function predictionMatchMap(row) {
    return new Map(row.matches.map((match) => [match.predictedIndex, match]));
  }

  function rowProblem(row) {
    return row.missedCount > 0 || row.falsePositiveCount > 0 || !row.exactSet;
  }

  function formatPercent(value, digits = 1) {
    return Number.isFinite(Number(value)) ? `${(Number(value) * 100).toFixed(digits)}%` : "—";
  }

  function formatMs(value) {
    const milliseconds = Math.max(0, Math.round(Number(value) || 0));
    const minutes = Math.floor(milliseconds / 60_000);
    const seconds = Math.floor(milliseconds % 60_000 / 1_000);
    const remainder = milliseconds % 1_000;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(remainder).padStart(3, "0")}`;
  }

  function finite(value, label) {
    const number = Number(value);
    if (!Number.isFinite(number)) throw new Error(`${label} 必须是有限数值`);
    return number;
  }

  function requireString(value, label) {
    if (typeof value !== "string" || !value.trim()) throw new Error(`${label} 不能为空`);
    return value.trim();
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function mount() {
    const shell = document.querySelector("[data-v7-alignment-review]");
    if (!shell || shell.dataset.mounted === "true") return;
    shell.dataset.mounted = "true";
    const byId = (id) => document.getElementById(id);
    const video = byId("alignmentVideo");
    const overlay = byId("poseOverlay");
    const overlayContext = overlay.getContext("2d");
    const plot = byId("trajectoryPlot");
    const plotContext = plot.getContext("2d");
    const state = {
      report: null,
      activeContextId: null,
      activeRow: null,
      pose: null,
      poseCache: new Map(),
      filter: "all",
      search: "",
      speedIndex: 1,
      layers: { skeleton: true, trail: true, equipment: true, labels: true },
      animationFrame: null,
    };

    async function init() {
      try {
        const response = await fetch("/api/review/v7-alignment", { headers: { Accept: "application/json" } });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
        state.report = normalizeReport(payload);
        renderOverall();
        renderList();
        await selectRow(state.report.rows[0].contextId);
        byId("v7Loading").hidden = true;
        byId("v7App").hidden = false;
        requestAnimationFrame(resizeAll);
        animate();
      } catch (error) {
        byId("v7LoadingTitle").textContent = "v7 对齐数据无法打开";
        byId("v7LoadingDetail").textContent = error.message || String(error);
      }
    }

    function renderOverall() {
      const aggregate = state.report.aggregate || {};
      byId("overallPrecision").textContent = formatPercent(aggregate.candidatePrecision);
      byId("overallRecall").textContent = formatPercent(aggregate.candidateRecall);
      byId("overallStrict").textContent = formatPercent(aggregate.strictBoundaryAlignedRate);
      byId("overallExact").textContent = formatPercent(aggregate.exactSetRate);
      const turnaround = state.report.turnaroundEvaluation || {};
      byId("overallFused").textContent = Number.isFinite(turnaround.equipmentFusedTurnaroundCount)
        && Number.isFinite(turnaround.rigidBarPredictedRepCount)
        ? `${turnaround.equipmentFusedTurnaroundCount}/${turnaround.rigidBarPredictedRepCount}`
        : "—";
    }

    function visibleRows() {
      const query = state.search.toLowerCase();
      return state.report.rows.filter((row) => {
        const searchable = `${row.exerciseId} ${row.capturePosition} ${row.sourceCaptureId}`.toLowerCase();
        const statusMatch = state.filter === "all"
          || (state.filter === "problem" && rowProblem(row))
          || (state.filter === "exact" && row.exactSet);
        return statusMatch && (!query || searchable.includes(query));
      });
    }

    function renderList() {
      byId("recordList").innerHTML = visibleRows().map((row, index) => {
        const recall = row.truthCount ? row.matchedCount / row.truthCount : 0;
        return `<button class="record ${rowProblem(row) ? "problem" : ""} ${row.contextId === state.activeContextId ? "active" : ""}" data-context-id="${escapeHtml(row.contextId)}">
          <span class="index">${String(index + 1).padStart(2, "0")}</span>
          <span><strong>${escapeHtml(row.exerciseId)}</strong><small>${escapeHtml(row.capturePosition)} · ${escapeHtml(row.sourceCaptureId)}</small></span>
          <span class="score">${Math.round(recall * 100)}</span>
        </button>`;
      }).join("") || `<div class="active-rep"><p>当前筛选没有记录。</p></div>`;
      byId("recordList").querySelectorAll("[data-context-id]").forEach((button) => {
        button.addEventListener("click", () => void selectRow(button.dataset.contextId));
      });
    }

    async function selectRow(contextId) {
      const row = state.report.rows.find((candidate) => candidate.contextId === contextId);
      if (!row) return;
      video.pause();
      state.activeContextId = contextId;
      state.activeRow = row;
      state.pose = null;
      renderList();
      renderCase();
      renderTimeline();
      renderInspector();
      video.src = row.videoUrl;
      video.load();
      byId("frameReadout").textContent = "POSE OBSERVATION · LOADING";
      try {
        if (!state.poseCache.has(row.sourceCaptureId)) {
          state.poseCache.set(row.sourceCaptureId, fetch(row.poseUrl, { headers: { Accept: "application/json" } })
            .then(async (response) => {
              const payload = await response.json();
              if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
              if (payload.poseSchema !== "halpe26" || !Array.isArray(payload.frames)) {
                throw new Error("Halpe-26 轨迹数据无效");
              }
              return payload;
            }));
        }
        state.pose = await state.poseCache.get(row.sourceCaptureId);
        drawAll();
      } catch (error) {
        byId("frameReadout").textContent = `POSE OBSERVATION ERROR · ${error.message || String(error)}`;
      }
    }

    function renderCase() {
      const row = state.activeRow;
      byId("caseKicker").textContent = `${row.exerciseId.toUpperCase()} / ${row.capturePosition.toUpperCase()}`;
      byId("caseTitle").textContent = `${row.truthCount} 次人工标注 · ${row.predictedCount} 次 v8 融合预测`;
      byId("caseId").textContent = row.sourceCaptureId;
    }

    function renderTimeline() {
      const row = state.activeRow;
      const duration = durationMs();
      const matched = predictionMatchMap(row);
      byId("truthTrack").innerHTML = row.truthRanges.map((range, index) => segmentHtml(
        range.startMs, range.endMs, duration, `H${index + 1}`, "truth",
      )).join("");
      byId("predictionTrack").innerHTML = row.predictedReps.map((rep, index) => {
        const match = matched.get(index);
        const status = !match ? "false" : (rep.disposition === "needs_review" ? "review" : "");
        return segmentHtml(
          rep.startMs,
          rep.endMs,
          duration,
          `V${index + 1}`,
          `prediction ${status}`,
          rep.turnaroundMs,
          row.phaseOrder,
          rep.turnaroundSource,
        );
      }).join("");
      byId("alignmentTimeline").querySelectorAll("[data-seek-ms]").forEach((button) => {
        button.addEventListener("click", () => {
          video.pause();
          video.currentTime = Number(button.dataset.seekMs) / 1000;
          updatePlayback();
        });
      });
    }

    function segmentHtml(startMs, endMs, duration, label, classes, turnaroundMs, phaseOrder, turnaroundSource) {
      const left = startMs / duration * 100;
      const width = Math.max(.15, (endMs - startMs) / duration * 100);
      const hasTurnaround = Number.isFinite(turnaroundMs) && turnaroundMs >= startMs && turnaroundMs <= endMs;
      const markerLeft = hasTurnaround ? (turnaroundMs - startMs) / Math.max(1, endMs - startMs) * 100 : 0;
      const phaseTitle = phaseOrder
        ? `${phaseLabel(phaseOrder[0])} → ${formatMs(turnaroundMs)} ${turnaroundSourceLabel(turnaroundSource)} → ${phaseLabel(phaseOrder[1])}`
        : "";
      const marker = hasTurnaround
        ? `<i class="turnaround-marker ${turnaroundSource === "equipment_fused" ? "equipment" : ""}" style="left:${markerLeft}%" aria-hidden="true"></i>`
        : "";
      return `<button class="segment ${classes}" style="left:${left}%;width:${width}%" data-seek-ms="${startMs}" title="${formatMs(startMs)}–${formatMs(endMs)}${phaseTitle ? ` · ${phaseTitle}` : ""}"><span>${label}</span>${marker}</button>`;
    }

    function renderInspector() {
      const row = state.activeRow;
      byId("recordCounts").textContent = `${row.truthCount} / ${row.predictedCount}`;
      byId("recordMatches").textContent = String(row.matchedCount);
      byId("recordMissed").textContent = String(row.missedCount);
      byId("recordFalse").textContent = String(row.falsePositiveCount);
      byId("recordMatches").className = row.matchedCount === row.truthCount ? "good" : "";
      renderActiveRep();
      const matchByPrediction = predictionMatchMap(row);
      const predictionRows = row.predictedReps.map((rep, index) => {
        const match = matchByPrediction.get(index);
        const phaseSummary = `${phaseLabel(row.phaseOrder[0])} ${formatMs(rep.turnaroundMs - rep.startMs)} · ${turnaroundSourceLabel(rep.turnaroundSource)} ${formatMs(rep.turnaroundMs)} · ${phaseLabel(row.phaseOrder[1])} ${formatMs(rep.endMs - rep.turnaroundMs)}`;
        return match
          ? `<div class="match-row ${match.strictBoundaryAligned ? "strict" : ""}"><b>V${index + 1}</b><span>↔ H${match.truthIndex + 1}<br>${phaseSummary}<br>START ${signed(match.startErrorMs)} · END ${signed(match.endErrorMs)}</span><em>IoU ${(match.intervalIou * 100).toFixed(0)}%${match.strictBoundaryAligned ? " · STRICT" : ""}</em></div>`
          : `<div class="match-row"><b>V${index + 1}</b><span>${formatMs(rep.startMs)}–${formatMs(rep.endMs)}<br>${phaseSummary}</span><em style="color:var(--red)">UNMATCHED</em></div>`;
      });
      const matchedTruth = new Set(row.matches.map((match) => match.truthIndex));
      const missedRows = row.truthRanges.flatMap((range, index) => matchedTruth.has(index) ? [] : [
        `<div class="match-row"><b>H${index + 1}</b><span>${formatMs(range.startMs)}–${formatMs(range.endMs)}</span><em style="color:var(--red)">MISSED</em></div>`,
      ]);
      byId("matchList").innerHTML = [...predictionRows, ...missedRows].join("") || `<div class="active-rep"><p>没有 Rep。</p></div>`;
      byId("qualityFindings").innerHTML = row.qualityFindingStates.map((value) => {
        const [dimension, findingState] = value.split("/");
        const status = findingState === "ObservedAcceptable" ? "acceptable"
          : findingState === "ObservedDeviation" ? "deviation" : "unknown";
        return `<div class="finding ${status}">${escapeHtml(dimension)}<br>${escapeHtml(findingState || "Unknown")}</div>`;
      }).join("");
      const catalogId = state.report.protocol?.modelConfiguration?.assessmentCatalogId || "UNKNOWN";
      byId("lineage").innerHTML = `CATALOG ${escapeHtml(catalogId)}<br>PHASE CONTRACT ${escapeHtml(row.phaseContractSource)} · ${phaseLabel(row.phaseOrder[0])} → ${phaseLabel(row.phaseOrder[1])}<br>EQUIPMENT ${escapeHtml(row.equipmentProvider.recognitionMode)} · ${row.equipmentProvider.frames.length} TRACK FRAMES<br>BUNDLE ${escapeHtml(row.bundleId)}<br>BUNDLE HASH ${escapeHtml(row.bundleHash)}<br>TRACE ROOTS ${row.traceRootCount}<br>TRACE HASH ${escapeHtml(row.traceContentHash)}<br>REPORT ${escapeHtml(state.report.reportDigest)}<br>PREDICTION ${escapeHtml(state.report.predictionSha256)}`;
    }

    function renderActiveRep() {
      const row = state.activeRow;
      if (!row) return;
      const currentMs = video.currentTime * 1000;
      const human = rangeAt(row.truthRanges, currentMs);
      const predicted = rangeAt(row.predictedReps.map((rep) => ({ startMs: rep.startMs, endMs: rep.endMs })), currentMs);
      const predictedRep = predicted ? row.predictedReps[predicted.index] : null;
      const activePhase = phaseAt(predictedRep, row.phaseOrder, currentMs);
      byId("activeRepSummary").innerHTML = `
        <div class="active-rep"><b>HUMAN ${human ? `REP ${human.index + 1}` : "非动作区间"}</b><p>${human ? `${formatMs(human.range.startMs)} → ${formatMs(human.range.endMs)}` : "当前时间不在人工作业 Rep 区间内。"}</p></div>
        <div class="active-rep"><b style="color:var(--cyan)">RUST V8 ${predicted ? `REP ${predicted.index + 1}` : "无 Rep"}</b><p>${predictedRep ? `${phaseLabel(row.phaseOrder[0])} ${formatMs(predictedRep.turnaroundMs - predictedRep.startMs)} → ${turnaroundSourceLabel(predictedRep.turnaroundSource)} ${formatMs(predictedRep.turnaroundMs)} → ${phaseLabel(row.phaseOrder[1])} ${formatMs(predictedRep.endMs - predictedRep.turnaroundMs)}` : "当前时间没有非 rejected 的 v8 Rep。"}</p></div>`;
      byId("humanRepHud").textContent = human ? `HUMAN REP ${human.index + 1}` : "HUMAN —";
      byId("v7RepHud").textContent = predicted ? `V8 REP ${predicted.index + 1}` : "V8 —";
      byId("v7PhaseHud").textContent = activePhase ? `${phaseLabel(activePhase.phase)} · V8` : "PHASE —";
    }

    function signed(value) {
      const rounded = Math.round(value);
      return `${rounded > 0 ? "+" : ""}${rounded}ms`;
    }

    function durationMs() {
      return Number(state.activeRow?.durationMs) || Math.round((video.duration || 0) * 1000) || 1;
    }

    function updatePlayback() {
      if (!state.activeRow) return;
      const currentMs = video.currentTime * 1000;
      const duration = durationMs();
      byId("playToggle").textContent = video.paused ? "▶" : "Ⅱ";
      byId("videoScrub").value = String(Math.max(0, Math.min(1000, currentMs / duration * 1000)));
      byId("timecode").textContent = `${formatMs(currentMs)} / ${formatMs(duration)}`;
      byId("timelinePlayhead").style.left = `${currentMs / duration * 100}%`;
      renderActiveRep();
      drawAll();
    }

    function resizeCanvas(canvas, context) {
      const rect = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(rect.width * ratio));
      canvas.height = Math.max(1, Math.round(rect.height * ratio));
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      return rect;
    }

    function resizeAll() {
      resizeCanvas(overlay, overlayContext);
      resizeCanvas(plot, plotContext);
      drawAll();
    }

    function drawAll() {
      drawPoseOverlay();
      drawTrajectoryPlot();
    }

    function videoTransform(width, height) {
      const scale = Math.min(width / (video.videoWidth || 1), height / (video.videoHeight || 1));
      return {
        width: (video.videoWidth || 1) * scale,
        height: (video.videoHeight || 1) * scale,
        offsetX: (width - (video.videoWidth || 1) * scale) / 2,
        offsetY: (height - (video.videoHeight || 1) * scale) / 2,
      };
    }

    function drawPoseOverlay() {
      const width = overlay.clientWidth;
      const height = overlay.clientHeight;
      overlayContext.clearRect(0, 0, width, height);
      if (!state.pose || !video.videoWidth || !video.videoHeight) return;
      const currentMs = video.currentTime * 1000;
      const frame = frameAt(state.pose.frames, currentMs);
      const transform = videoTransform(width, height);
      if (state.layers.trail) {
        drawWristTrail(9, currentMs, transform, "rgba(77,228,238,.78)");
        drawWristTrail(10, currentMs, transform, "rgba(255,211,78,.78)");
        if (state.layers.equipment) drawEquipmentTrail(currentMs, transform);
      }
      if (frame && state.layers.skeleton) drawSkeleton(frame.landmarks || [], transform);
      const equipmentFrame = state.layers.equipment
        ? frameAt(state.activeRow.equipmentProvider.frames, currentMs)
        : null;
      if (equipmentFrame) drawEquipmentAxis(equipmentFrame, transform);
      if (frame && state.layers.labels) drawRepLabels(currentMs, transform);
      const visible = frame?.landmarks?.filter(visiblePoint).length || 0;
      byId("frameReadout").textContent = frame
        ? `OBS ${formatMs(frame.timestampMs)} · FRAME ${frame.frameNumber} · HALPE26 ${visible}/26 · BAR ${equipmentFrame ? `${equipmentFrame.source.toUpperCase()} ${(equipmentFrame.confidence * 100).toFixed(0)}% ±${equipmentFrame.uncertaintyPx.toFixed(1)}PX` : "UNKNOWN"}`
        : "POSE OBSERVATION UNKNOWN · no frame within 180ms";
    }

    function drawSkeleton(points, transform) {
      overlayContext.save();
      overlayContext.lineCap = "round";
      overlayContext.lineJoin = "round";
      overlayContext.strokeStyle = "rgba(202,255,56,.88)";
      overlayContext.lineWidth = 2;
      for (const [from, to] of HALPE26_EDGES) {
        if (!visiblePoint(points[from]) || !visiblePoint(points[to])) continue;
        const a = mapPoint(points[from], transform);
        const b = mapPoint(points[to], transform);
        overlayContext.beginPath(); overlayContext.moveTo(a.x, a.y); overlayContext.lineTo(b.x, b.y); overlayContext.stroke();
      }
      points.forEach((point, index) => {
        if (!visiblePoint(point)) return;
        const mapped = mapPoint(point, transform);
        overlayContext.fillStyle = index === 9 ? "#4de4ee" : index === 10 ? "#ffd34e" : "#edf3e8";
        overlayContext.beginPath(); overlayContext.arc(mapped.x, mapped.y, index === 9 || index === 10 ? 4 : 2.5, 0, Math.PI * 2); overlayContext.fill();
      });
      overlayContext.restore();
    }

    function drawWristTrail(index, currentMs, transform, color) {
      const samples = state.pose.frames.filter((frame) => frame.timestampMs <= currentMs
        && frame.timestampMs >= currentMs - 1_500
        && visiblePoint(frame.landmarks?.[index]));
      if (samples.length < 2) return;
      overlayContext.save();
      overlayContext.strokeStyle = color;
      overlayContext.lineWidth = 3;
      overlayContext.beginPath();
      samples.forEach((frame, sampleIndex) => {
        const point = mapPoint(frame.landmarks[index], transform);
        if (sampleIndex === 0) overlayContext.moveTo(point.x, point.y);
        else overlayContext.lineTo(point.x, point.y);
      });
      overlayContext.stroke();
      overlayContext.restore();
    }

    function drawEquipmentTrail(currentMs, transform) {
      const samples = state.activeRow.equipmentProvider.frames.filter((frame) => frame.timestampMs <= currentMs
        && frame.timestampMs >= currentMs - 1_500);
      if (samples.length < 2) return;
      overlayContext.save();
      overlayContext.strokeStyle = "rgba(255,77,206,.7)";
      overlayContext.lineWidth = 3;
      overlayContext.beginPath();
      let previousTimestampMs = null;
      samples.forEach((frame) => {
        const point = mapPoint({ x: (frame.x1 + frame.x2) / 2, y: frame.centerY }, transform);
        if (previousTimestampMs === null || frame.timestampMs - previousTimestampMs > 180) {
          overlayContext.moveTo(point.x, point.y);
        }
        else overlayContext.lineTo(point.x, point.y);
        previousTimestampMs = frame.timestampMs;
      });
      overlayContext.stroke();
      overlayContext.restore();
    }

    function drawEquipmentAxis(frame, transform) {
      const from = mapPoint({ x: frame.x1, y: frame.y1 }, transform);
      const to = mapPoint({ x: frame.x2, y: frame.y2 }, transform);
      const style = frame.source === "Measured"
        ? { color: "#ff4dce", dash: [], width: 4 }
        : frame.source === "Predicted"
          ? { color: "#ffd34e", dash: [8, 5], width: 3 }
          : { color: "#4de4ee", dash: [3, 4], width: 3 };
      overlayContext.save();
      overlayContext.strokeStyle = style.color;
      overlayContext.fillStyle = style.color;
      overlayContext.lineWidth = style.width;
      overlayContext.lineCap = "round";
      overlayContext.setLineDash(style.dash);
      overlayContext.shadowColor = style.color;
      overlayContext.shadowBlur = frame.source === "Measured" ? 12 : 5;
      overlayContext.beginPath(); overlayContext.moveTo(from.x, from.y); overlayContext.lineTo(to.x, to.y); overlayContext.stroke();
      overlayContext.setLineDash([]);
      for (const point of [from, to]) {
        overlayContext.beginPath(); overlayContext.arc(point.x, point.y, 4, 0, Math.PI * 2); overlayContext.fill();
      }
      overlayContext.restore();
    }

    function drawRepLabels(currentMs, transform) {
      const human = rangeAt(state.activeRow.truthRanges, currentMs);
      const predicted = rangeAt(state.activeRow.predictedReps.map((rep) => ({ startMs: rep.startMs, endMs: rep.endMs })), currentMs);
      overlayContext.save();
      overlayContext.font = "900 11px SFMono-Regular, monospace";
      overlayContext.fillStyle = "rgba(5,8,7,.82)";
      overlayContext.fillRect(transform.offsetX + 12, transform.offsetY + transform.height - 45, 230, 31);
      overlayContext.fillStyle = "#caff38";
      overlayContext.fillText(human ? `HUMAN REP ${human.index + 1}` : "HUMAN —", transform.offsetX + 22, transform.offsetY + transform.height - 25);
      overlayContext.fillStyle = "#4de4ee";
      overlayContext.fillText(predicted ? `V8 REP ${predicted.index + 1}` : "V8 —", transform.offsetX + 132, transform.offsetY + transform.height - 25);
      overlayContext.restore();
    }

    function drawTrajectoryPlot() {
      const width = plot.clientWidth;
      const height = plot.clientHeight;
      plotContext.clearRect(0, 0, width, height);
      if (!state.pose || !state.activeRow) return;
      const duration = durationMs();
      plotContext.save();
      plotContext.strokeStyle = "rgba(127,139,130,.2)";
      plotContext.lineWidth = 1;
      for (let y = 1; y < 4; y += 1) {
        plotContext.beginPath(); plotContext.moveTo(0, y / 4 * height); plotContext.lineTo(width, y / 4 * height); plotContext.stroke();
      }
      state.activeRow.truthRanges.forEach((range) => {
        plotContext.fillStyle = "rgba(202,255,56,.06)";
        plotContext.fillRect(range.startMs / duration * width, 0, (range.endMs - range.startMs) / duration * width, height);
      });
      const matched = predictionMatchMap(state.activeRow);
      state.activeRow.predictedReps.forEach((rep, index) => {
        if (matched.has(index)) return;
        plotContext.fillStyle = "rgba(255,96,73,.12)";
        plotContext.fillRect(rep.startMs / duration * width, 0, (rep.endMs - rep.startMs) / duration * width, height);
      });
      state.activeRow.predictedReps.forEach((rep) => {
        const x = rep.turnaroundMs / duration * width;
        plotContext.strokeStyle = rep.turnaroundSource === "equipment_fused"
          ? "rgba(255,77,206,.9)"
          : "rgba(255,255,255,.68)";
        plotContext.lineWidth = 1;
        plotContext.setLineDash([3, 3]);
        plotContext.beginPath(); plotContext.moveTo(x, 0); plotContext.lineTo(x, height); plotContext.stroke();
      });
      plotContext.setLineDash([]);
      drawSignal(9, "#4de4ee");
      drawSignal(10, "#ffd34e");
      drawEquipmentSignal();
      const playheadX = video.currentTime * 1000 / duration * width;
      plotContext.strokeStyle = "rgba(255,255,255,.9)";
      plotContext.beginPath(); plotContext.moveTo(playheadX, 0); plotContext.lineTo(playheadX, height); plotContext.stroke();
      plotContext.restore();

      function drawSignal(index, color) {
        let started = false;
        plotContext.strokeStyle = color;
        plotContext.lineWidth = 1.6;
        plotContext.beginPath();
        state.pose.frames.forEach((frame) => {
          const point = frame.landmarks?.[index];
          if (!visiblePoint(point)) { started = false; return; }
          const x = Number(frame.timestampMs) / duration * width;
          const y = Number(point.y) * height;
          if (!started) { plotContext.moveTo(x, y); started = true; }
          else plotContext.lineTo(x, y);
        });
        plotContext.stroke();
      }

      function drawEquipmentSignal() {
        if (!state.layers.equipment || !state.activeRow.equipmentProvider.frames.length) return;
        let started = false;
        plotContext.strokeStyle = "#ff4dce";
        plotContext.lineWidth = 2.2;
        plotContext.beginPath();
        let previousTimestampMs = null;
        state.activeRow.equipmentProvider.frames.forEach((frame) => {
          const x = frame.timestampMs / duration * width;
          const y = frame.centerY * height;
          if (!started || previousTimestampMs === null || frame.timestampMs - previousTimestampMs > 180) {
            plotContext.moveTo(x, y);
            started = true;
          }
          else plotContext.lineTo(x, y);
          previousTimestampMs = frame.timestampMs;
        });
        plotContext.stroke();
      }
    }

    function visiblePoint(point) {
      return Boolean(point) && Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y))
        && Number(point.visibility ?? 1) >= .15;
    }

    function mapPoint(point, transform) {
      return {
        x: transform.offsetX + Number(point.x) * transform.width,
        y: transform.offsetY + Number(point.y) * transform.height,
      };
    }

    function animate() {
      if (!video.paused && !video.ended) updatePlayback();
      state.animationFrame = requestAnimationFrame(animate);
    }

    byId("recordSearch").addEventListener("input", (event) => {
      state.search = event.target.value.trim();
      renderList();
    });
    document.querySelectorAll("[data-filter]").forEach((button) => button.addEventListener("click", () => {
      state.filter = button.dataset.filter;
      document.querySelectorAll("[data-filter]").forEach((candidate) => candidate.classList.toggle("active", candidate === button));
      renderList();
    }));
    document.querySelectorAll("[data-layer]").forEach((button) => button.addEventListener("click", () => {
      const layer = button.dataset.layer;
      state.layers[layer] = !state.layers[layer];
      button.classList.toggle("active", state.layers[layer]);
      drawAll();
    }));
    byId("playToggle").addEventListener("click", () => video.paused ? void video.play() : video.pause());
    byId("stepBack").addEventListener("click", () => { video.pause(); video.currentTime = Math.max(0, video.currentTime - 1 / 30); updatePlayback(); });
    byId("stepForward").addEventListener("click", () => { video.pause(); video.currentTime = Math.min(video.duration || Infinity, video.currentTime + 1 / 30); updatePlayback(); });
    byId("videoScrub").addEventListener("input", (event) => { video.currentTime = Number(event.target.value) / 1000 * durationMs() / 1000; updatePlayback(); });
    byId("speedToggle").addEventListener("click", () => {
      state.speedIndex = (state.speedIndex + 1) % SPEEDS.length;
      video.playbackRate = SPEEDS[state.speedIndex];
      byId("speedToggle").textContent = `${video.playbackRate.toFixed(1)}×`;
    });
    video.addEventListener("loadedmetadata", () => {
      byId("videoStage").style.setProperty("--video-aspect", `${video.videoWidth} / ${video.videoHeight}`);
      updatePlayback();
      requestAnimationFrame(resizeAll);
    });
    video.addEventListener("timeupdate", updatePlayback);
    video.addEventListener("play", updatePlayback);
    video.addEventListener("pause", updatePlayback);
    window.addEventListener("resize", resizeAll);
    void init();
  }

  function phaseLabel(phase) {
    return phase === "concentric" ? "向心" : phase === "eccentric" ? "离心" : "阶段未知";
  }

  function turnaroundSourceLabel(source) {
    return source === "equipment_fused" ? "器械融合换向" : "姿态换向";
  }

  return Object.freeze({
    mount,
    normalizeReport,
    frameAt,
    rangeAt,
    phaseAt,
    predictionMatchMap,
    rowProblem,
    formatPercent,
    formatMs,
  });
});
