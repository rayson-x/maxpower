(function attachQualityReviewApp(root, factory) {
  const qualityReviewDocument = typeof module === "object" && module.exports
    ? require("./qualityReviewDocument.js")
    : root.QualityReviewDocument;
  const playerMath = typeof module === "object" && module.exports
    ? require("./playerMath.js")
    : root.ReviewPlayerMath;
  const api = factory(qualityReviewDocument, playerMath);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.QualityReviewApp = api;
  if (typeof document === "object") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => api.mount());
    else api.mount();
  }
})(typeof globalThis === "object" ? globalThis : this, function createQualityReviewAppModule(
  QualityReviewDocument,
  ReviewPlayerMath,
) {
  "use strict";

  const RELEASE_SCHEMA = "maxpower-motion-quality-review-release/v1";
  const EXPORT_SCHEMA = "maxpower-motion-quality-review-release-export/v1";
  const ENDPOINTS = ["start_anchor", "primary_turnaround", "end_return"];
  const HALPE26_EDGES = [
    [0, 1], [0, 2], [1, 3], [2, 4],
    [5, 7], [7, 9], [6, 8], [8, 10], [5, 6], [5, 11], [6, 12], [11, 12],
    [11, 13], [13, 15], [12, 14], [14, 16],
    [17, 18], [18, 5], [18, 6], [18, 19], [19, 11], [19, 12],
    [15, 20], [15, 22], [15, 24], [20, 22], [16, 21], [16, 23], [16, 25], [21, 23],
  ];
  const ENDPOINT_LABELS = {
    start_anchor: "起始锚点",
    primary_turnaround: "主换向点",
    end_return: "返回端点",
  };
  const DIMENSION_LABELS = {
    task_completion: "动作任务完成",
    range_of_motion: "行程与端点",
    phase_control: "阶段控制",
    support_stability: "支撑稳定",
    bilateral_coordination: "双侧协调",
    trajectory_control: "轨迹控制",
    standard_variant_compatibility: "标准变式兼容性",
    observation_confidence: "观测可信度",
  };

  function dimensionLabel(key) {
    return DIMENSION_LABELS[key] || key;
  }

  function createWorkspace(rawRelease, rawReviewer) {
    const release = freezeJson(cloneJson(normalizeRelease(rawRelease)));
    let reviewer = normalizeReviewer(rawReviewer);
    const documents = new Map(release.items.map((item) => [
      item.itemId,
      QualityReviewDocument.createReviewDocument({ proposal: item.proposal, reviewer }),
    ]));

    return Object.freeze({
      release,
      get reviewer() { return reviewer; },
      review(itemId) {
        const review = documents.get(itemId);
        if (!review) throw new Error(`unknown quality review item ${itemId}`);
        return review;
      },
      progress(itemId) {
        const items = itemId ? release.items.filter((item) => item.itemId === itemId) : release.items;
        if (itemId && items.length === 0) throw new Error(`unknown quality review item ${itemId}`);
        const total = items.reduce((sum, item) => sum + targetCount(item.proposal), 0);
        const decided = items.reduce((sum, item) => sum + documents.get(item.itemId).listDecisions().length, 0);
        return Object.freeze({ decided, total });
      },
      exportJson(rawMetadata) {
        const metadata = cloneJson(requireRecord(rawMetadata, "export metadata"));
        const proposalReviews = release.items.map((item) => ({
          itemId: item.itemId,
          captureId: item.captureId,
          review: JSON.parse(documents.get(item.itemId).exportJson(metadata)),
        }));
        return stableJson({
          schemaVersion: EXPORT_SCHEMA,
          releaseId: release.releaseId,
          releaseHash: release.releaseHash,
          runKind: release.runKind,
          evidenceLineage: {
            benchmark: release.evidenceRuns?.benchmark ? {
              runKind: release.evidenceRuns.benchmark.runKind,
              acceptanceEligible: release.evidenceRuns.benchmark.acceptanceEligible,
              runId: release.evidenceRuns.benchmark.frozenPredictions?.runId,
              frozenDigest: release.evidenceRuns.benchmark.frozenPredictions?.frozenDigest,
            } : null,
            calibration: release.evidenceRuns?.calibration ?? null,
          },
          reviewer: cloneJson(reviewer),
          exportMetadata: metadata,
          proposalReviews,
        });
      },
      importJson(json) {
        if (typeof json !== "string") throw new Error("review import must be JSON text");
        let value;
        try {
          value = requireRecord(JSON.parse(json), "review export");
        } catch (error) {
          if (error instanceof SyntaxError) throw new Error("review import is invalid JSON");
          throw error;
        }
        if (value.schemaVersion !== EXPORT_SCHEMA) throw new Error("unsupported quality review export schema");
        if (value.releaseId !== release.releaseId || value.releaseHash !== release.releaseHash) {
          throw new Error("quality review export release mismatch");
        }
        if (!Array.isArray(value.proposalReviews)) throw new Error("quality review proposal reviews are invalid");
        const imported = new Map();
        for (const rawEntry of value.proposalReviews) {
          const entry = requireRecord(rawEntry, "proposal review");
          const item = release.items.find((candidate) => candidate.itemId === entry.itemId);
          if (!item) throw new Error(`unknown quality review item ${String(entry.itemId)}`);
          if (imported.has(item.itemId)) throw new Error(`duplicate quality review item ${item.itemId}`);
          const reviewPayload = requireRecord(entry.review, "proposal review payload");
          const review = QualityReviewDocument.importReviewDocument({
            proposal: item.proposal,
            json: stableJson(reviewPayload),
          });
          imported.set(item.itemId, review);
        }
        if (imported.size !== release.items.length) throw new Error("quality review export is incomplete");
        reviewer = freezeJson(cloneJson(normalizeReviewer(value.reviewer)));
        for (const [itemId, review] of imported) documents.set(itemId, review);
        return this;
      },
    });
  }

  function syncExistingDecisionDraft(review, target, rawDraft) {
    const existing = review.getDecision(target);
    if (!existing) return null;
    const draft = requireRecord(rawDraft, "review decision draft");
    if (!Object.prototype.hasOwnProperty.call(draft, "correctedValue")) {
      throw new Error("correctedValue must be explicitly provided as a value or null");
    }
    return review.setDecision({
      target: existing.target,
      verdict: existing.verdict,
      correctedValue: draft.correctedValue,
      note: draft.note ?? null,
    });
  }

  function normalizeRelease(value) {
    const release = requireRecord(value, "quality review release");
    if (release.schemaVersion !== RELEASE_SCHEMA) throw new Error("unsupported quality review release schema");
    requireString(release.releaseId, "releaseId");
    requireString(release.releaseHash, "releaseHash");
    requireString(release.runKind, "runKind");
    requireString(release.frozenAt, "frozenAt");
    if (release.evidenceRuns != null) {
      const evidenceRuns = requireRecord(release.evidenceRuns, "evidence runs");
      const benchmark = requireRecord(evidenceRuns.benchmark, "benchmark evidence run");
      const frozen = requireRecord(benchmark.frozenPredictions, "frozen benchmark predictions");
      if (!["maxpower-motion-quality-frozen-predictions/v1", "maxpower-motion-quality-touched-benchmark-predictions/v1"].includes(frozen.schemaVersion)
          || frozen.state !== "frozen_before_truth"
          || !Array.isArray(frozen.contexts)) {
        throw new Error("frozen benchmark predictions are invalid");
      }
      requireString(frozen.runId, "frozen benchmark run id");
      requireString(frozen.frozenDigest, "frozen benchmark digest");
      const calibration = requireRecord(evidenceRuns.calibration, "calibration evidence run");
      if (calibration.runKind !== "full_data_proposal") throw new Error("calibration evidence run is invalid");
    }
    if (!Array.isArray(release.items) || !release.items.length) throw new Error("quality review release has no items");
    const ids = new Set();
    release.items.forEach((rawItem) => {
      const item = requireRecord(rawItem, "quality review item");
      const itemId = requireString(item.itemId, "itemId");
      if (ids.has(itemId)) throw new Error(`duplicate quality review item ${itemId}`);
      ids.add(itemId);
      requireString(item.captureId, "captureId");
      requireString(item.videoUrl, "videoUrl");
      const proposal = requireRecord(item.proposal, "proposal");
      requireString(proposal.proposalHash, "proposalHash");
      requireRecord(proposal.lineage, "proposal lineage");
      if (!Array.isArray(proposal.reps)) throw new Error("proposal reps must be an array");
    });
    return release;
  }

  function normalizeReviewer(value) {
    const reviewer = requireRecord(value, "reviewer");
    return freezeJson({
      reviewerId: requireString(reviewer.reviewerId, "reviewerId"),
      reviewerRole: requireString(reviewer.reviewerRole, "reviewerRole"),
    });
  }

  function frameAt(frames, timestampMs, maximumAgeMs) {
    return ReviewPlayerMath.nearestFrameWithinAge(frames || [], timestampMs, maximumAgeMs);
  }

  function trajectoryUntil(points, timestampMs) {
    if (!Array.isArray(points)) return [];
    return points.filter((point) => Number.isFinite(point.timestampMs) && point.timestampMs <= timestampMs);
  }

  function benchmarkEvidenceForItem(release, item) {
    const contexts = release?.evidenceRuns?.benchmark?.frozenPredictions?.contexts;
    if (!Array.isArray(contexts)) return null;
    const contextId = item?.evidenceLinks?.benchmarkContextId ?? item?.captureId;
    if (!contextId) return null;
    return contexts.find((context) => context.contextId === contextId) || null;
  }

  function lineageSummary(lineage) {
    const value = lineage || {};
    const appliedPolicy = value.appliedPolicy || {};
    return [
      value.profileIdentity ?? value.profileVersion,
      value.profileHash,
      appliedPolicy.candidate,
      appliedPolicy.policyHash ?? appliedPolicy.reportDigest,
      value.ruleVersion,
      value.motionPacketHash,
    ].filter(Boolean).join(" · ") || value.runId || value.schemaVersion || "lineage pinned";
  }

  function targetCount(proposal) {
    return proposal.reps.reduce((sum, rep) => sum + ENDPOINTS.length + rep.conclusions.length, 0);
  }

  function stableJson(value) {
    return `${JSON.stringify(sortJson(value), null, 2)}\n`;
  }

  function sortJson(value) {
    if (Array.isArray(value)) return value.map(sortJson);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortJson(value[key])]));
    }
    return value;
  }

  function cloneJson(value, seen = new Set()) {
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) throw new Error("quality review contains a non-finite number");
      return value;
    }
    if (typeof value !== "object") throw new Error("quality review must contain JSON values only");
    if (seen.has(value)) throw new Error("quality review contains a circular value");
    seen.add(value);
    const cloned = Array.isArray(value)
      ? value.map((entry) => cloneJson(entry, seen))
      : Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, cloneJson(entry, seen)]));
    seen.delete(value);
    return cloned;
  }

  function freezeJson(value) {
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
      Object.values(value).forEach(freezeJson);
      Object.freeze(value);
    }
    return value;
  }

  function requireRecord(value, label) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
    return value;
  }

  function requireString(value, label) {
    if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
    return value.trim();
  }

  function mount() {
    const shell = document.querySelector("[data-quality-review-app]");
    if (!shell || shell.dataset.mounted === "true") return;
    shell.dataset.mounted = "true";
    const byId = (id) => document.getElementById(id);
    const state = {
      workspace: null,
      activeItemId: null,
      activeRepId: null,
      activeItem: null,
      activeReview: null,
      evidenceMode: "calibration",
      layers: { skeleton: true, equipment: true, trails: true },
    };
    const video = byId("qualityVideo");
    const canvas = byId("qualityOverlay");
    const context = canvas.getContext("2d");

    async function init() {
      try {
        const response = await fetch("/api/review/quality-release", {
          method: "GET",
          headers: { Accept: "application/json" },
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
        state.workspace = createWorkspace(payload, {
          reviewerId: payload.defaultReviewer?.reviewerId || "owner",
          reviewerRole: payload.defaultReviewer?.reviewerRole || "owner_observation",
        });
        renderReleaseHeader();
        selectItem(state.workspace.release.items[0].itemId);
        byId("qualityLoading").hidden = true;
        byId("qualityApp").hidden = false;
        requestAnimationFrame(resizeOverlay);
      } catch (error) {
        byId("qualityLoadingTitle").textContent = "冻结发布包无法打开";
        byId("qualityLoadingDetail").textContent = error.message || String(error);
        byId("qualityLoading").classList.add("failed");
      }
    }

    function renderReleaseHeader() {
      const release = state.workspace.release;
      byId("releaseId").textContent = release.releaseId;
      byId("runKind").textContent = release.evidenceRuns
        ? "冻结基准 + 全量校准"
        : (release.runKind === "blind_evaluation" ? "盲测冻结结果" : "全数据审核提案");
      byId("releaseHash").textContent = release.releaseHash;
      byId("frozenAt").textContent = formatDate(release.frozenAt);
      renderProgress();
      document.querySelectorAll("[data-evidence-mode]").forEach((button) => {
        button.hidden = !release.evidenceRuns;
        button.classList.toggle("active", button.dataset.evidenceMode === state.evidenceMode);
      });
    }

    function selectEvidenceMode(mode) {
      if (!state.workspace?.release.evidenceRuns || !["benchmark", "calibration"].includes(mode)) return;
      state.evidenceMode = mode;
      document.querySelectorAll("[data-evidence-mode]").forEach((button) => {
        button.classList.toggle("active", button.dataset.evidenceMode === mode);
      });
      byId("evidenceModeReadout").textContent = mode === "benchmark"
        ? "已调参冻结基准 · 原样只读 · 不可作为泛化验收"
        : "全量校准提案 · 可逐项审核 · 不可作为泛化验收";
      selectItem(state.activeItemId || state.workspace.release.items[0].itemId);
    }

    function selectItem(itemId) {
      const item = state.workspace.release.items.find((candidate) => candidate.itemId === itemId);
      if (!item) return;
      video.pause();
      state.activeItemId = itemId;
      state.activeItem = item;
      state.activeReview = state.workspace.review(itemId);
      state.activeRepId = activeModeReps()[0]?.repId || null;
      byId("qualityStage").style.removeProperty("--media-aspect");
      video.src = item.videoUrl;
      video.load();
      renderQueue();
      renderItemHeader();
      renderRepTabs();
      renderReviewPanel();
      renderTimeline();
      if (activeModeReps()[0]) {
        video.currentTime = repEndpointTime(activeModeReps()[0], "start_anchor") / 1000;
      }
      updatePlayback();
    }

    function renderQueue() {
      byId("qualityQueue").innerHTML = state.workspace.release.items.map((item, index) => {
        const progress = state.workspace.progress(item.itemId);
        const benchmark = benchmarkEvidenceForItem(state.workspace.release, item);
        const context = item.context || item.exercise || {};
        const title = item.title || [context.action, context.view].filter(Boolean).join(" · ") || item.captureId;
        return `<button type="button" class="queue-item ${item.itemId === state.activeItemId ? "active" : ""}" data-item-id="${escapeHtml(item.itemId)}">
          <span class="queue-index">${String(index + 1).padStart(2, "0")}</span>
          <span class="queue-copy"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(item.captureId)}</small></span>
          <span class="queue-progress">${state.evidenceMode === "calibration" ? `${progress.decided}/${progress.total}` : `${benchmark?.reps?.length ?? 0} REP`}</span>
        </button>`;
      }).join("");
      byId("qualityQueue").querySelectorAll("[data-item-id]").forEach((button) => {
        button.addEventListener("click", () => selectItem(button.dataset.itemId));
      });
    }

    function renderItemHeader() {
      const item = state.activeItem;
      const context = item.context || item.exercise || {};
      byId("itemTitle").textContent = item.title || context.action || item.captureId;
      byId("itemContext").textContent = [context.variant, context.equipment, context.view, context.anatomicalSide]
        .filter(Boolean).join(" · ") || item.captureId;
      byId("capabilityBadge").textContent = String(item.capability || "observation_only").replaceAll("_", " ");
      const benchmark = benchmarkEvidenceForItem(state.workspace.release, item);
      if (state.evidenceMode === "benchmark") {
        byId("proposalHash").textContent = benchmark?.proposalHash || "NO FROZEN PROPOSAL";
        byId("lineageReadout").textContent = benchmark
          ? [benchmark.versions?.visualModel, benchmark.versions?.rustEngine, benchmark.packetHash].filter(Boolean).join(" · ")
          : "当前上下文没有冻结基准提案";
        byId("capabilityBadge").textContent = String(benchmark?.capability || "unsupported").replaceAll("_", " ");
      } else {
        byId("proposalHash").textContent = state.activeReview.proposal.proposalHash;
        const lineage = state.activeReview.proposal.lineage;
        byId("lineageReadout").textContent = lineageSummary(lineage);
      }
    }

    function renderRepTabs() {
      const reps = activeModeReps();
      byId("repTabs").innerHTML = reps.map((rep, index) => {
        const decisions = state.evidenceMode === "calibration"
          ? state.activeReview.listDecisions().filter((decision) => decision.target.repId === rep.repId).length
          : 0;
        const total = state.evidenceMode === "calibration" ? ENDPOINTS.length + rep.conclusions.length : 0;
        return `<button type="button" class="rep-tab ${rep.repId === state.activeRepId ? "active" : ""}" data-rep-id="${escapeHtml(rep.repId)}">
          <span>REP ${String(index + 1).padStart(2, "0")}</span><small>${state.evidenceMode === "calibration" ? `${decisions}/${total}` : escapeHtml(rep.disposition || "frozen")}</small>
        </button>`;
      }).join("");
      byId("repTabs").querySelectorAll("[data-rep-id]").forEach((button) => button.addEventListener("click", () => {
        state.activeRepId = button.dataset.repId;
        renderRepTabs();
        renderReviewPanel();
        const rep = activeRep();
        if (rep) video.currentTime = repEndpointTime(rep, "start_anchor") / 1000;
      }));
    }

    function renderReviewPanel() {
      const rep = activeRep();
      if (!rep) {
        const benchmark = benchmarkEvidenceForItem(state.workspace.release, state.activeItem);
        byId("endpointReviews").innerHTML = `<p class=empty>${state.evidenceMode === "benchmark" ? `冻结基准没有 Rep。${escapeHtml(benchmark?.unsupportedReason || "不可据此验收")}` : "此校准提案没有 Rep。"}</p>`;
        byId("conclusionReviews").innerHTML = state.evidenceMode === "benchmark"
          ? "<p class=empty>此处只展示冻结推理原文，不生成或修改审核标签。</p>"
          : "";
        return;
      }
      byId("activeRepTitle").textContent = rep.repId;
      if (state.evidenceMode === "benchmark") {
        const benchmark = benchmarkEvidenceForItem(state.workspace.release, state.activeItem);
        byId("endpointReviews").innerHTML = ENDPOINTS.map((endpoint) => `<article class="review-card endpoint-card">
          <div class="card-lead"><span class="card-number">${ENDPOINTS.indexOf(endpoint) + 1}</span><div><h3>${ENDPOINT_LABELS[endpoint]}</h3><p>${formatMs(repEndpointTime(rep, endpoint))} · 冻结单次因果输出</p></div><button class="seek-chip" type="button" data-seek-ms="${repEndpointTime(rep, endpoint)}">定位</button></div>
        </article>`).join("");
        const conclusions = Array.isArray(benchmark?.qualityConclusions) ? benchmark.qualityConclusions : [];
        byId("conclusionReviews").innerHTML = conclusions.length
          ? conclusions.map((conclusion) => `<article class="review-card conclusion-card"><code>${escapeHtml(JSON.stringify(conclusion))}</code></article>`).join("")
          : "<p class=empty>冻结基准没有质量结论；这不是全量校准提案。</p>";
        document.querySelectorAll("#endpointReviews [data-seek-ms]").forEach((button) => button.addEventListener("click", () => {
          video.pause(); video.currentTime = Number(button.dataset.seekMs) / 1000; updatePlayback();
        }));
        return;
      }
      byId("endpointReviews").innerHTML = ENDPOINTS.map((endpoint) => endpointCard(rep, endpoint)).join("");
      byId("conclusionReviews").innerHTML = rep.conclusions.length
        ? rep.conclusions.map((conclusion) => conclusionCard(rep, conclusion)).join("")
        : "<p class=empty>Rust 未提出具体质量结论。</p>";
      bindReviewControls();
    }

    function endpointCard(rep, endpoint) {
      const value = rep.endpoints[endpoint];
      const target = { kind: "endpoint", repId: rep.repId, endpoint };
      const decision = state.activeReview.getDecision(target);
      const occurred = endpointTime(value);
      const confirmed = Number(
        value.causalConfirmedTimestampMs
          ?? value.confirmedAtMs
          ?? value.confirmed_at_ms
          ?? occurred,
      );
      return `<article class="review-card endpoint-card" data-kind="endpoint" data-rep-id="${escapeHtml(rep.repId)}" data-endpoint="${endpoint}">
        <div class="card-lead"><span class="card-number">${ENDPOINTS.indexOf(endpoint) + 1}</span><div><h3>${ENDPOINT_LABELS[endpoint]}</h3><p>${formatMs(occurred)} · 因果确认 ${formatMs(confirmed)}</p></div><button class="seek-chip" type="button" data-seek-ms="${occurred}">定位</button></div>
        ${decisionControls(decision, "端点修正 ms", decision?.correctedValue?.occurredAtMs ?? "", "number")}
      </article>`;
    }

    function conclusionCard(rep, conclusion) {
      const target = { kind: "conclusion", repId: rep.repId, conclusionId: conclusion.conclusionId };
      const decision = state.activeReview.getDecision(target);
      const stateValue = conclusion.state ?? conclusion.value ?? "cannot_judge";
      const evidence = Array.isArray(conclusion.evidence) ? conclusion.evidence : [];
      return `<article class="review-card conclusion-card" data-kind="conclusion" data-rep-id="${escapeHtml(rep.repId)}" data-conclusion-id="${escapeHtml(conclusion.conclusionId)}">
        <div class="conclusion-head"><div><span class="dimension">${escapeHtml(dimensionLabel(conclusion.dimension))}</span><h3>${escapeHtml(conclusion.text || conclusion.summary || stateValue)}</h3></div><span class="confidence">${formatConfidence(conclusion.confidence)}</span></div>
        <p class="conclusion-state ${escapeHtml(stateValue)}">${escapeHtml(stateValue.replaceAll("_", " "))}${conclusion.reason ? ` · ${escapeHtml(conclusion.reason)}` : ""}</p>
        ${evidence.length ? `<div class="evidence-list">${evidence.map((entry) => `<code>${escapeHtml(typeof entry === "string" ? entry : JSON.stringify(entry))}</code>`).join("")}</div>` : "<p class=muted>没有额外证据引用</p>"}
        ${decisionControls(decision, "可选修正值（JSON 或文本）", correctionText(decision?.correctedValue), "text")}
      </article>`;
    }

    function decisionControls(decision, correctionLabel, correctionValue, inputType) {
      return `<div class="decision-grid">
        <div class="verdicts" role="group" aria-label="审核结论">
          ${["correct", "incorrect", "cannot_judge"].map((verdict) => `<button type="button" class="verdict ${decision?.verdict === verdict ? `selected ${verdict}` : ""}" data-verdict="${verdict}">${verdictLabel(verdict)}</button>`).join("")}
        </div>
        <label class="field"><span>${correctionLabel}</span><input class="correction-input" type="${inputType}" value="${escapeHtml(correctionValue)}" placeholder="可留空"></label>
        <label class="field note-field"><span>审核备注</span><input class="note-input" type="text" value="${escapeHtml(decision?.note || "")}" placeholder="可选"></label>
      </div>`;
    }

    function bindReviewControls() {
      document.querySelectorAll(".review-card").forEach((card) => {
        card.querySelectorAll("[data-verdict]").forEach((button) => button.addEventListener("click", () => {
          const target = reviewTargetForCard(card);
          const draft = reviewDraftForCard(card);
          if (draft.error) {
            setNotice("端点修正必须是毫秒数", "error");
            return;
          }
          state.activeReview.setDecision({
            target,
            verdict: button.dataset.verdict,
            correctedValue: draft.correctedValue,
            note: draft.note,
          });
          setNotice("已保留在当前页面内存；尚未导出。", "ok");
          renderQueue();
          renderRepTabs();
          renderReviewPanel();
          renderProgress();
        }));
        card.querySelectorAll(".correction-input, .note-input").forEach((input) => {
          const syncDraft = () => {
            const target = reviewTargetForCard(card);
            if (!state.activeReview.getDecision(target)) return;
            const draft = reviewDraftForCard(card);
            if (draft.error) {
              setNotice("端点修正必须是毫秒数", "error");
              return;
            }
            syncExistingDecisionDraft(state.activeReview, target, draft);
            setNotice("修改已更新到当前页面内存；尚未导出。", "ok");
          };
          input.addEventListener("input", syncDraft);
          input.addEventListener("change", syncDraft);
        });
        const seek = card.querySelector("[data-seek-ms]");
        if (seek) seek.addEventListener("click", () => {
          video.pause();
          video.currentTime = Number(seek.dataset.seekMs) / 1000;
          updatePlayback();
        });
      });
    }

    function reviewTargetForCard(card) {
      return card.dataset.kind === "endpoint"
        ? { kind: "endpoint", repId: card.dataset.repId, endpoint: card.dataset.endpoint }
        : { kind: "conclusion", repId: card.dataset.repId, conclusionId: card.dataset.conclusionId };
    }

    function reviewDraftForCard(card) {
      const correctionInput = card.querySelector(".correction-input");
      const noteInput = card.querySelector(".note-input");
      const correctedValue = card.dataset.kind === "endpoint"
        ? (correctionInput.value.trim() ? { occurredAtMs: Math.round(Number(correctionInput.value)) } : null)
        : parseCorrection(correctionInput.value);
      return {
        correctedValue,
        note: noteInput.value || null,
        error: card.dataset.kind === "endpoint"
          && correctedValue
          && !Number.isFinite(correctedValue.occurredAtMs),
      };
    }

    function renderProgress() {
      const progress = state.workspace.progress();
      byId("reviewProgressText").textContent = `${progress.decided} / ${progress.total}`;
      byId("reviewProgressBar").style.width = `${progress.total ? progress.decided / progress.total * 100 : 0}%`;
    }

    function renderTimeline() {
      const item = state.activeItem;
      const duration = durationMs();
      const humanSegments = item.humanSegments || [];
      const reps = activeModeReps();
      const marks = [];
      reps.forEach((rep, repIndex) => ENDPOINTS.forEach((endpoint) => {
        const time = repEndpointTime(rep, endpoint);
        marks.push(`<button type="button" class="endpoint-mark ${endpoint}" style="left:${pct(time, duration)}" data-seek-ms="${time}" aria-label="REP ${repIndex + 1} ${ENDPOINT_LABELS[endpoint]}"><span>${repIndex + 1}</span></button>`);
      }));
      byId("truthTrack").innerHTML = humanSegments.map((segment, index) => `<button type="button" class="truth-range" style="left:${pct(segment.startMs, duration)};width:${pct(segment.endMs - segment.startMs, duration)}" data-seek-ms="${segment.startMs}"><span>H${index + 1}</span></button>`).join("");
      byId("proposalTrack").innerHTML = marks.join("");
      document.querySelectorAll("#qualityTimeline [data-seek-ms]").forEach((button) => button.addEventListener("click", () => {
        video.pause();
        video.currentTime = Number(button.dataset.seekMs) / 1000;
        updatePlayback();
      }));
    }

    function activeRep() {
      return activeModeReps().find((rep) => rep.repId === state.activeRepId) || null;
    }

    function activeModeReps() {
      if (state.evidenceMode === "benchmark") {
        return benchmarkEvidenceForItem(state.workspace?.release, state.activeItem)?.reps || [];
      }
      return state.activeReview?.proposal.reps || [];
    }

    function durationMs() {
      return Number(state.activeItem?.durationMs) || Math.round((video.duration || 0) * 1000) || 1;
    }

    function updatePlayback() {
      if (!state.activeItem) return;
      const currentMs = video.currentTime * 1000;
      byId("qualityPlay").textContent = video.paused ? "▶" : "Ⅱ";
      byId("qualityTimecode").textContent = `${formatMs(currentMs)} / ${formatMs(durationMs())}`;
      byId("qualityPlayhead").style.left = pct(currentMs, durationMs());
      drawOverlay();
    }

    function resizeOverlay() {
      const rect = byId("qualityStage").getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(rect.width * ratio));
      canvas.height = Math.max(1, Math.round(rect.height * ratio));
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      drawOverlay();
    }

    function updateMediaAspect() {
      if (!video.videoWidth || !video.videoHeight) return;
      byId("qualityStage").style.setProperty("--media-aspect", `${video.videoWidth} / ${video.videoHeight}`);
      requestAnimationFrame(resizeOverlay);
    }

    function drawOverlay() {
      if (!state.activeItem || !video.videoWidth || !video.videoHeight) return;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      context.clearRect(0, 0, width, height);
      const evidence = state.activeItem.evidence || {};
      const currentMs = video.currentTime * 1000;
      const frame = frameAt(evidence.frames || [], currentMs, Number(evidence.maximumOverlayAgeMs) || 150);
      const scale = Math.min(width / video.videoWidth, height / video.videoHeight);
      const transform = {
        renderedWidth: video.videoWidth * scale,
        renderedHeight: video.videoHeight * scale,
        offsetX: (width - video.videoWidth * scale) / 2,
        offsetY: (height - video.videoHeight * scale) / 2,
      };
      if (state.layers.trails) drawTrajectories(evidence.equipmentTrajectories || [], currentMs, transform);
      if (frame && state.layers.skeleton) drawSkeleton(frame.landmarks || frame.skeleton || [], transform);
      if (frame && state.layers.equipment) drawEquipment(frame.equipment || (frame.axis ? [frame.axis] : []), transform);
      const visible = frame ? (frame.landmarks || frame.skeleton || []).filter(isVisiblePoint).length : 0;
      const equipmentCount = frame ? (frame.equipment || (frame.axis ? [frame.axis] : [])).length : 0;
      byId("observationReadout").textContent = frame
        ? `OBS ${formatMs(frame.timestampMs)} · POSE ${visible} · EQUIPMENT ${equipmentCount}`
        : "OBSERVATION UNKNOWN · no frame within 150 ms";
    }

    function drawSkeleton(points, transform) {
      context.save();
      context.lineCap = "round";
      context.lineJoin = "round";
      context.lineWidth = 2.4;
      for (const [from, to] of HALPE26_EDGES) {
        const a = points[from];
        const b = points[to];
        if (!isVisiblePoint(a) || !isVisiblePoint(b)) continue;
        const pa = mapPoint(a, transform);
        const pb = mapPoint(b, transform);
        const predicted = a.predicted || b.predicted || a.source === "predicted" || b.source === "predicted";
        context.setLineDash(predicted ? [6, 5] : []);
        context.strokeStyle = predicted ? "rgba(255,104,72,.92)" : "rgba(202,255,57,.92)";
        context.beginPath(); context.moveTo(pa.x, pa.y); context.lineTo(pb.x, pb.y); context.stroke();
      }
      context.setLineDash([]);
      points.forEach((point) => {
        if (!isVisiblePoint(point)) return;
        const position = mapPoint(point, transform);
        context.fillStyle = point.predicted || point.source === "predicted" ? "#ff6848" : "#f7f7ed";
        context.beginPath(); context.arc(position.x, position.y, 3.2, 0, Math.PI * 2); context.fill();
      });
      context.restore();
    }

    function drawEquipment(observations, transform) {
      context.save();
      context.lineCap = "round";
      observations.forEach((observation) => {
        const axis = observation.axis || observation;
        if ([axis.x1, axis.y1, axis.x2, axis.y2].every(Number.isFinite)) {
          const a = mapPoint({ x: axis.x1, y: axis.y1 }, transform);
          const b = mapPoint({ x: axis.x2, y: axis.y2 }, transform);
          context.strokeStyle = "rgba(0,0,0,.72)"; context.lineWidth = 8;
          context.beginPath(); context.moveTo(a.x, a.y); context.lineTo(b.x, b.y); context.stroke();
          context.strokeStyle = "#ffd84a"; context.lineWidth = 3;
          context.beginPath(); context.moveTo(a.x, a.y); context.lineTo(b.x, b.y); context.stroke();
        } else if ([observation.x, observation.y, observation.width, observation.height].every(Number.isFinite)) {
          const topLeft = mapPoint(observation, transform);
          context.strokeStyle = "#ffd84a"; context.lineWidth = 2;
          context.strokeRect(topLeft.x, topLeft.y, observation.width * transform.renderedWidth, observation.height * transform.renderedHeight);
        } else if (Array.isArray(observation.points)) {
          drawPath(observation.points, transform, "#ffd84a", 3);
        }
      });
      context.restore();
    }

    function drawTrajectories(trajectories, currentMs, transform) {
      context.save();
      trajectories.forEach((trajectory, index) => {
        const points = trajectoryUntil(trajectory.points || trajectory.samples || [], currentMs)
          .map(normalizeTrajectoryPoint).filter(Boolean).slice(-180);
        drawPath(points, transform, index % 2 ? "rgba(85,220,231,.8)" : "rgba(255,216,74,.85)", 2);
      });
      context.restore();
    }

    function drawPath(points, transform, color, width) {
      if (points.length < 2) return;
      context.strokeStyle = color;
      context.lineWidth = width;
      context.beginPath();
      points.forEach((point, index) => {
        const position = mapPoint(point, transform);
        if (index === 0) context.moveTo(position.x, position.y);
        else context.lineTo(position.x, position.y);
      });
      context.stroke();
    }

    function normalizeTrajectoryPoint(point) {
      const x = point.x ?? point.centerX ?? (Number.isFinite(point.x1) && Number.isFinite(point.x2) ? (point.x1 + point.x2) / 2 : null);
      const y = point.y ?? point.centerY ?? (Number.isFinite(point.y1) && Number.isFinite(point.y2) ? (point.y1 + point.y2) / 2 : null);
      return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
    }

    function mapPoint(point, transform) {
      return {
        x: transform.offsetX + Number(point.x) * transform.renderedWidth,
        y: transform.offsetY + Number(point.y) * transform.renderedHeight,
      };
    }

    function isVisiblePoint(point) {
      return Boolean(point)
        && Number.isFinite(point.x)
        && Number.isFinite(point.y)
        && point.renderable !== false
        && Number(point.visibility ?? point.confidence ?? 1) >= 0.15;
    }

    function exportReviews() {
      const now = new Date().toISOString();
      const json = state.workspace.exportJson({
        exportId: `${state.workspace.release.releaseId}-${now.replace(/[:.]/g, "-")}`,
        exportedAt: now,
        applicationVersion: "quality-review/v1",
      });
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${state.workspace.release.releaseId}-manual-review.json`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      setNotice("审核 JSON 已显式导出；页面没有写入服务器、训练集或 Profile。", "ok");
    }

    async function importReviews(file) {
      if (!file) return;
      try {
        state.workspace.importJson(await file.text());
        state.activeReview = state.workspace.review(state.activeItemId);
        renderQueue(); renderRepTabs(); renderReviewPanel(); renderProgress();
        setNotice("已从本地文件恢复审核决定；仍只存在当前页面内存。", "ok");
      } catch (error) {
        setNotice(error.message || String(error), "error");
      }
    }

    function setNotice(message, kind) {
      const node = byId("qualityNotice");
      node.textContent = message;
      node.className = `notice ${kind || ""}`;
    }

    byId("qualityPlay").addEventListener("click", () => video.paused ? video.play() : video.pause());
    byId("qualityPrevFrame").addEventListener("click", () => stepFrame(-1));
    byId("qualityNextFrame").addEventListener("click", () => stepFrame(1));
    byId("qualityExport").addEventListener("click", exportReviews);
    byId("qualityImport").addEventListener("change", (event) => importReviews(event.target.files?.[0]));
    document.querySelectorAll("[data-evidence-mode]").forEach((button) => button.addEventListener("click", () => {
      selectEvidenceMode(button.dataset.evidenceMode);
    }));
    document.querySelectorAll("[data-quality-layer]").forEach((button) => button.addEventListener("click", () => {
      const layer = button.dataset.qualityLayer;
      state.layers[layer] = !state.layers[layer];
      button.classList.toggle("active", state.layers[layer]);
      drawOverlay();
    }));
    video.addEventListener("timeupdate", updatePlayback);
    video.addEventListener("play", updatePlayback);
    video.addEventListener("pause", updatePlayback);
    video.addEventListener("loadedmetadata", () => {
      updateMediaAspect();
      renderTimeline();
      resizeOverlay();
      updatePlayback();
    });
    window.addEventListener("resize", resizeOverlay);
    if ("requestVideoFrameCallback" in video) {
      const onFrame = () => { updatePlayback(); video.requestVideoFrameCallback(onFrame); };
      video.requestVideoFrameCallback(onFrame);
    }

    function stepFrame(direction) {
      video.pause();
      const frames = state.activeItem?.evidence?.frames || [];
      const currentMs = video.currentTime * 1000;
      let target;
      if (direction > 0) {
        target = ReviewPlayerMath.nextFrameTimestamp(frames, currentMs, durationMs());
      } else {
        target = [...frames].reverse().find((frame) => frame.timestampMs < currentMs - 0.5)?.timestampMs;
        if (!Number.isFinite(target)) target = Math.max(0, currentMs - 1000 / 30);
      }
      video.currentTime = target / 1000;
      updatePlayback();
    }

    void init();
  }

  function endpointTime(endpoint) {
    return Number(
      endpoint?.occurredTimestampMs
        ?? endpoint?.occurredAtMs
        ?? endpoint?.occurred_at_ms
        ?? 0,
    );
  }

  function repEndpointTime(rep, endpoint) {
    if (rep?.endpoints) return endpointTime(rep.endpoints[endpoint]);
    if (endpoint === "start_anchor") return Number(rep?.startTimestampMs ?? rep?.startMs ?? 0);
    if (endpoint === "primary_turnaround") return Number(rep?.turnaroundTimestampMs ?? rep?.peakTimestampMs ?? rep?.turnaroundMs ?? 0);
    return Number(rep?.endTimestampMs ?? rep?.endMs ?? 0);
  }

  function pct(value, duration) {
    return `${Math.max(0, Math.min(100, Number(value) / Math.max(1, Number(duration)) * 100))}%`;
  }

  function formatMs(value) {
    const ms = Math.max(0, Math.round(Number(value) || 0));
    const minutes = Math.floor(ms / 60_000);
    const seconds = Math.floor((ms % 60_000) / 1_000);
    const millis = ms % 1_000;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
  }

  function formatDate(value) {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toLocaleString("zh-CN", { hour12: false }) : String(value);
  }

  function formatConfidence(value) {
    return Number.isFinite(value) ? `${Math.round(Number(value) * 100)}%` : "—";
  }

  function verdictLabel(value) {
    if (value === "correct") return "正确";
    if (value === "incorrect") return "错误";
    return "无法判断";
  }

  function correctionText(value) {
    if (value == null) return "";
    return typeof value === "string" ? value : JSON.stringify(value);
  }

  function parseCorrection(value) {
    const trimmed = String(value || "").trim();
    if (!trimmed) return null;
    try { return JSON.parse(trimmed); } catch (_) { return trimmed; }
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
    })[character]);
  }

  return {
    benchmarkEvidenceForItem,
    EXPORT_SCHEMA,
    RELEASE_SCHEMA,
    createWorkspace,
    dimensionLabel,
    frameAt,
    lineageSummary,
    mount,
    syncExistingDecisionDraft,
    trajectoryUntil,
  };
});
