(function attachQualityReviewApp(root, factory) {
  const qualityReviewDocument = typeof module === "object" && module.exports
    ? require("./qualityReviewDocument.js")
    : root.QualityReviewDocument;
  const playerMath = typeof module === "object" && module.exports
    ? require("./playerMath.js")
    : root.ReviewPlayerMath;
  const qualityReviewI18n = typeof module === "object" && module.exports
    ? require("./qualityReviewI18n.js")
    : root.QualityReviewI18n;
  const api = factory(qualityReviewDocument, playerMath, qualityReviewI18n);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.QualityReviewApp = api;
  if (typeof document === "object") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => api.mount());
    else api.mount();
  }
})(typeof globalThis === "object" ? globalThis : this, function createQualityReviewAppModule(
  QualityReviewDocument,
  ReviewPlayerMath,
  QualityReviewI18n,
) {
  "use strict";

  const RELEASE_SCHEMA = "maxpower-motion-quality-review-release/v1";
  const EXPORT_SCHEMA = "maxpower-motion-quality-review-release-export/v1";
  const LOCAL_DRAFT_PREFIX = "maxpower.motion-quality-review.draft/v1";
  const ENDPOINTS = ["start_anchor", "primary_turnaround", "end_return"];
  const DEFERRED_ABSTENTION_DIMENSIONS = new Set([
    "support_stability",
    "bilateral_coordination",
    "standard_variant_compatibility",
  ]);
  const CORRECTED_CONCLUSION_STATES = Object.freeze([
    Object.freeze({ value: "observed_acceptable", label: "应为：观测范围内可接受" }),
    Object.freeze({ value: "observed_deviation", label: "应为：观察到偏差" }),
    Object.freeze({ value: "cannot_judge", label: "应为：证据不足，无法判断" }),
    Object.freeze({ value: "not_applicable", label: "应为：当前动作/机位不适用" }),
  ]);
  const REVIEW_ISSUE_CODES = Object.freeze([
    Object.freeze({ value: "rep_or_endpoint_wrong", label: "依赖的 Rep / 端点错误" }),
    Object.freeze({ value: "pose_evidence_wrong", label: "骨架证据错误或缺失" }),
    Object.freeze({ value: "equipment_evidence_wrong", label: "器材证据错误或缺失" }),
    Object.freeze({ value: "local_coordinate_wrong", label: "局部坐标/归一化错误" }),
    Object.freeze({ value: "fusion_decision_wrong", label: "融合或冲突处理错误" }),
    Object.freeze({ value: "feature_or_threshold_wrong", label: "特征值或阈值错误" }),
    Object.freeze({ value: "conclusion_state_wrong", label: "结论状态错误" }),
    Object.freeze({ value: "explanation_or_limit_wrong", label: "解释、文案或限制错误" }),
    Object.freeze({ value: "review_evidence_insufficient", label: "审核画面不足，无法确认" }),
    Object.freeze({ value: "other", label: "其他（请写备注）" }),
  ]);
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
  const EVIDENCE_LAYER_DEFINITIONS = Object.freeze([
    Object.freeze({ key: "rawSkeleton", label: "原始骨架" }),
    Object.freeze({ key: "rawEquipment", label: "原始器械" }),
    Object.freeze({ key: "normalizedPose", label: "归一化骨架" }),
    Object.freeze({ key: "normalizedEquipment", label: "归一化器械" }),
    Object.freeze({ key: "fusionStatus", label: "融合状态" }),
  ]);
  const LOCAL_TRAJECTORY_DISPLAY_SCALE = 0.2;

  function dimensionLabel(key) {
    return DIMENSION_LABELS[key] || key;
  }

  function conclusionReviewPriority(conclusion) {
    return DEFERRED_ABSTENTION_DIMENSIONS.has(conclusion?.dimension)
      && conclusion?.state === "cannot_judge"
      ? "known_gap"
      : "core";
  }

  function reviewTargets(proposal) {
    return proposal.reps.flatMap((rep) => [
      ...ENDPOINTS.map((endpoint) => ({
        target: { kind: "endpoint", repId: rep.repId, endpoint },
        priority: "core",
      })),
      ...rep.conclusions.map((conclusion) => ({
        target: { kind: "conclusion", repId: rep.repId, conclusionId: conclusion.conclusionId },
        priority: conclusionReviewPriority(conclusion),
      })),
    ]);
  }

  function reviewTargetKey(target) {
    return target.kind === "endpoint"
      ? `${target.repId}\u0000endpoint\u0000${target.endpoint}`
      : `${target.repId}\u0000conclusion\u0000${target.conclusionId}`;
  }

  function structuredConclusionCorrection(expectedState, issueCode) {
    const normalizedState = String(expectedState || "").trim();
    const normalizedIssue = String(issueCode || "").trim();
    if (!normalizedState && !normalizedIssue) return null;
    return Object.freeze({
      schemaVersion: "maxpower-motion-quality-correction/v1",
      expectedState: normalizedState || null,
      issueCode: normalizedIssue || null,
    });
  }

  function correctionSelection(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return Object.freeze({ expectedState: "", issueCode: "" });
    }
    return Object.freeze({
      expectedState: String(value.expectedState ?? value.state ?? ""),
      issueCode: String(value.issueCode ?? value.reason ?? ""),
    });
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
        const rows = items.flatMap((item) => reviewTargets(item.proposal).map((row) => ({
          ...row,
          itemId: item.itemId,
        })));
        const decisions = items.flatMap((item) => documents.get(item.itemId).listDecisions().map((decision) => ({
          decision,
          itemId: item.itemId,
        })));
        const coreRows = rows.filter((row) => row.priority === "core");
        const decidedKeys = new Set(decisions.map(({ decision, itemId: decisionItemId }) => (
          `${decisionItemId}\u0000${reviewTargetKey(decision.target)}`
        )));
        const coreDecided = coreRows.filter((row) => decidedKeys.has(
          `${row.itemId}\u0000${reviewTargetKey(row.target)}`,
        )).length;
        return Object.freeze({
          decided: decisions.length,
          total: rows.length,
          coreDecided,
          coreTotal: coreRows.length,
          optionalDecided: decisions.length - coreDecided,
          optionalTotal: rows.length - coreRows.length,
        });
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

  function draftStorageKey(release) {
    const value = requireRecord(release, "quality review release");
    const releaseId = requireString(value.releaseId, "releaseId");
    const releaseHash = requireString(value.releaseHash, "releaseHash");
    return `${LOCAL_DRAFT_PREFIX}:${encodeURIComponent(releaseId)}:${encodeURIComponent(releaseHash)}`;
  }

  function saveLocalDraft(storage, workspace, savedAt = new Date().toISOString()) {
    requireStorage(storage);
    const timestamp = requireString(savedAt, "local draft savedAt");
    const progress = workspace.progress();
    const json = workspace.exportJson({
      exportId: `local-draft-${workspace.release.releaseId}-${timestamp.replace(/[:.]/g, "-")}`,
      exportedAt: timestamp,
      applicationVersion: "quality-review/v1",
      persistence: "browser_local_draft",
    });
    storage.setItem(draftStorageKey(workspace.release), json);
    return Object.freeze({ decided: progress.decided, savedAt: timestamp });
  }

  function restoreLocalDraft(storage, workspace) {
    requireStorage(storage);
    const json = storage.getItem(draftStorageKey(workspace.release));
    if (json == null) return Object.freeze({ restored: false, decided: 0, savedAt: null });
    let parsed;
    try {
      parsed = JSON.parse(json);
    } catch (_) {
      throw new Error("browser-local review draft is invalid JSON");
    }
    workspace.importJson(json);
    return Object.freeze({
      restored: true,
      decided: workspace.progress().decided,
      savedAt: parsed?.exportMetadata?.exportedAt ?? null,
    });
  }

  function clearLocalDraft(storage, release) {
    requireStorage(storage);
    storage.removeItem(draftStorageKey(release));
  }

  function requireStorage(storage) {
    if (!storage
        || typeof storage.getItem !== "function"
        || typeof storage.setItem !== "function"
        || typeof storage.removeItem !== "function") {
      throw new Error("browser-local review storage is unavailable");
    }
    return storage;
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

  function equipmentAxisGeometry(observation) {
    const axis = observation?.axis || observation;
    if (![axis?.x1, axis?.y1, axis?.x2, axis?.y2].every(Number.isFinite)) return null;
    return Object.freeze({ x1: axis.x1, y1: axis.y1, x2: axis.x2, y2: axis.y2 });
  }

  function canonicalEquipmentTracks(value) {
    if (Array.isArray(value.equipmentTracks)) return value.equipmentTracks;
    if (Array.isArray(value.equipment)) return value.equipment;
    if (Array.isArray(value.equipment?.tracks)) return value.equipment.tracks;
    return value.axis ? [value.axis] : [];
  }

  function localCoordinateOf(value) {
    return value.localMotionCoordinate
      ?? value.local_motion_coordinate
      ?? value.localCoordinate
      ?? null;
  }

  function normalizedReviewPoint(channel) {
    const alongAxisProgress = channel?.alongAxisProgress ?? channel?.along_axis_progress;
    const crossAxisDisplacement = channel?.crossAxisDisplacement ?? channel?.cross_axis_displacement;
    if (!channel
        || !Number.isFinite(alongAxisProgress)
        || !Number.isFinite(crossAxisDisplacement)) return null;
    return Object.freeze({
      x: 0.5 + crossAxisDisplacement * LOCAL_TRAJECTORY_DISPLAY_SCALE,
      y: 0.5 + alongAxisProgress * LOCAL_TRAJECTORY_DISPLAY_SCALE,
    });
  }

  function normalizedChannelEvidence(channel, timestampMs) {
    const point = normalizedReviewPoint(channel);
    if (!point) return null;
    return Object.freeze({
      timestampMs: Number.isFinite(timestampMs) ? timestampMs : null,
      point,
      alongAxisProgress: channel.alongAxisProgress ?? channel.along_axis_progress,
      crossAxisDisplacement: channel.crossAxisDisplacement ?? channel.cross_axis_displacement,
      confidence: Number.isFinite(channel.confidence) ? channel.confidence : null,
      coverage: finiteOrNull(channel.coverage),
      uncertainty: finiteOrNull(channel.uncertainty),
      provenance: channel.provenance ?? "unknown",
      predicted: isPredictedEvidence(channel),
    });
  }

  function fusionEvidence(coordinate) {
    return Object.freeze({
      status: coordinate?.channelAgreement ?? coordinate?.channel_agreement ?? "cannot_judge",
      confidence: Number.isFinite(coordinate?.confidence) ? coordinate.confidence : null,
      reason: coordinate?.reason ?? null,
    });
  }

  function coordinateStatusSummary(coordinate) {
    const value = coordinate || {};
    return Object.freeze({
      coordinateFrameId: value.coordinateFrameId ?? value.coordinate_frame_id ?? null,
      state: value.state ?? "uninitialized",
      scale: Number.isFinite(value.scale) ? value.scale : null,
      scaleSource: value.scaleSource ?? value.scale_source ?? null,
      confidence: Number.isFinite(value.confidence) ? value.confidence : null,
      reason: value.reason ?? null,
      fusionStatus: value.channelAgreement ?? value.channel_agreement ?? "cannot_judge",
    });
  }

  function coordinateStatusText(coordinate, includeFusion = true) {
    if (!coordinate) return "COORD UNAVAILABLE · REASON no_coordinate_evidence";
    const status = coordinate.coordinateFrameId === undefined
      ? coordinateStatusSummary(coordinate)
      : coordinate;
    const frame = status.coordinateFrameId == null ? "" : ` #${status.coordinateFrameId}`;
    const scale = status.scaleSource || Number.isFinite(status.scale)
      ? ` · SCALE ${status.scaleSource ?? "unknown"} ${Number.isFinite(status.scale) ? status.scale.toFixed(3) : "—"}`
      : " · SCALE —";
    const confidence = ` · CONF ${Number.isFinite(status.confidence) ? `${Math.round(status.confidence * 100)}%` : "—"}`;
    const reason = ` · REASON ${status.reason ?? "none"}`;
    const fusion = includeFusion ? ` · FUSION ${status.fusionStatus ?? "cannot_judge"}` : "";
    return `COORD${frame} · ${String(status.state ?? "uninitialized").toUpperCase()}${scale}${confidence}${reason}${fusion}`;
  }

  const COORDINATE_STATE_COPY = Object.freeze({
    uninitialized: Object.freeze({ zh: "未初始化", en: "Uninitialized" }),
    provisional: Object.freeze({ zh: "初步校准", en: "Provisional" }),
    learning: Object.freeze({ zh: "学习中", en: "Learning" }),
    frozen: Object.freeze({ zh: "已冻结", en: "Frozen" }),
    degraded: Object.freeze({ zh: "已降级", en: "Degraded" }),
  });
  const COORDINATE_REASON_COPY = Object.freeze({
    no_set: Object.freeze({ zh: "尚未开始训练组", en: "Set has not started" }),
    no_locked_subject: Object.freeze({ zh: "未锁定前景主体", en: "Foreground subject is not locked" }),
    no_measured_bar_axis: Object.freeze({ zh: "没有可靠实测杠轴", en: "No reliable measured bar axis" }),
    insufficient_preparation: Object.freeze({ zh: "准备阶段可靠观测不足", en: "Insufficient reliable preparation observations" }),
    subject_changed: Object.freeze({ zh: "检测到主体切换", en: "Subject changed" }),
    observation_gap: Object.freeze({ zh: "观测中断时间过长", en: "Observation gap exceeded the limit" }),
    invalid_geometry: Object.freeze({ zh: "器械几何无效", en: "Equipment geometry is invalid" }),
    no_coordinate_evidence: Object.freeze({ zh: "暂无局部坐标证据", en: "Local-coordinate evidence unavailable" }),
    none: Object.freeze({ zh: "无", en: "None" }),
  });
  const FUSION_STATUS_COPY = Object.freeze({
    agreement: Object.freeze({ zh: "骨架与器械一致", en: "Pose and equipment agree" }),
    equipment_only: Object.freeze({ zh: "仅器械通道", en: "Equipment channel only" }),
    pose_only: Object.freeze({ zh: "仅骨架通道", en: "Pose channel only" }),
    conflict: Object.freeze({ zh: "通道冲突", en: "Channel conflict" }),
    cannot_judge: Object.freeze({ zh: "无法判断", en: "Cannot judge" }),
  });

  function coordinateEvidenceSummary(coordinate) {
    if (!coordinate) return Object.freeze({ available: false, reason: "no_coordinate_evidence" });
    const rawBarAxis = coordinate.rawBarAxis ?? coordinate.raw_bar_axis ?? null;
    const validRawBarAxis = Array.isArray(rawBarAxis)
      && rawBarAxis.length === 4
      && rawBarAxis.every(Number.isFinite)
      ? Object.freeze(rawBarAxis.slice())
      : null;
    const rawAngleRadians = finiteOrNull(
      coordinate.rawBarAngleRadians ?? coordinate.raw_bar_angle_radians,
    ) ?? (validRawBarAxis
      ? Math.atan2(validRawBarAxis[3] - validRawBarAxis[1], validRawBarAxis[2] - validRawBarAxis[0])
      : null);
    const correctedAngleRadians = finiteOrNull(
      coordinate.baselineCorrectedBarAngleRadians
        ?? coordinate.baseline_corrected_bar_angle_radians,
    );
    const endpointOneProgress = finiteOrNull(
      coordinate.endpointOneProgress ?? coordinate.endpoint_one_progress,
    );
    const endpointTwoProgress = finiteOrNull(
      coordinate.endpointTwoProgress ?? coordinate.endpoint_two_progress,
    );
    const anatomicalLeftEndpointProgress = finiteOrNull(
      coordinate.anatomicalLeftEndpointProgress
        ?? coordinate.anatomical_left_endpoint_progress,
    );
    const anatomicalRightEndpointProgress = finiteOrNull(
      coordinate.anatomicalRightEndpointProgress
        ?? coordinate.anatomical_right_endpoint_progress,
    );
    const equipment = coordinate.equipment || {};
    const pose = coordinate.pose || {};
    return Object.freeze({
      available: true,
      coordinateFrameId: coordinate.coordinateFrameId ?? coordinate.coordinate_frame_id ?? null,
      state: coordinate.state ?? "uninitialized",
      reason: coordinate.reason ?? null,
      scale: finiteOrNull(coordinate.scale),
      scaleSource: coordinate.scaleSource ?? coordinate.scale_source ?? null,
      confidence: finiteOrNull(coordinate.confidence),
      fusionStatus: coordinate.channelAgreement ?? coordinate.channel_agreement ?? "cannot_judge",
      rawBarAxis: validRawBarAxis,
      coarseView: coordinate.coarseView ?? coordinate.coarse_view ?? null,
      canonicalFeedMirrored: coordinate.canonicalFeedMirrored
        ?? coordinate.canonical_feed_mirrored
        ?? null,
      endpointOrderMapping: coordinate.endpointOrderMapping
        ?? coordinate.endpoint_order_mapping
        ?? null,
      anatomicalSideMapping: coordinate.anatomicalSideMapping
        ?? coordinate.anatomical_side_mapping
        ?? "unknown",
      rawAngleDegrees: radiansToRoundedDegrees(rawAngleRadians),
      correctedAngleDegrees: radiansToRoundedDegrees(correctedAngleRadians),
      equipmentProgress: finiteOrNull(equipment.alongAxisProgress ?? equipment.along_axis_progress),
      equipmentCrossAxisDisplacement: finiteOrNull(
        equipment.crossAxisDisplacement ?? equipment.cross_axis_displacement,
      ),
      equipmentCoverage: finiteOrNull(equipment.coverage),
      equipmentUncertainty: finiteOrNull(equipment.uncertainty),
      poseCoverage: finiteOrNull(pose.coverage),
      poseUncertainty: finiteOrNull(pose.uncertainty),
      endpointOneProgress,
      endpointTwoProgress,
      anatomicalLeftEndpointProgress,
      anatomicalRightEndpointProgress,
      endpointResidual: endpointOneProgress == null || endpointTwoProgress == null
        ? null
        : roundNumber(endpointTwoProgress - endpointOneProgress, 6),
    });
  }

  function coordinateEvidenceHtml(summary) {
    const value = summary?.available === false || !summary
      ? { available: false, reason: summary?.reason ?? "no_coordinate_evidence" }
      : summary;
    if (!value.available) {
      const reason = bilingualCopy(COORDINATE_REASON_COPY, value.reason, "暂无局部坐标证据", "Local-coordinate evidence unavailable");
      return `<div class="coordinate-evidence-empty"><strong>${escapeHtml(reason.zh)}</strong><span>${escapeHtml(reason.en)}</span></div>`;
    }
    const state = bilingualCopy(COORDINATE_STATE_COPY, value.state, String(value.state), String(value.state));
    const reason = bilingualCopy(
      COORDINATE_REASON_COPY,
      value.reason ?? "none",
      String(value.reason ?? "无"),
      String(value.reason ?? "None"),
    );
    const fusion = bilingualCopy(
      FUSION_STATUS_COPY,
      value.fusionStatus,
      String(value.fusionStatus),
      String(value.fusionStatus),
    );
    const endpointMapping = value.anatomicalSideMapping === "endpoint_one_anatomical_left"
      ? Object.freeze({
        zh: "端点 1 = 解剖左侧；端点 2 = 解剖右侧",
        en: "Endpoint 1 = anatomical left; Endpoint 2 = anatomical right",
      })
      : value.anatomicalSideMapping === "endpoint_one_anatomical_right"
        ? Object.freeze({
          zh: "端点 1 = 解剖右侧；端点 2 = 解剖左侧",
          en: "Endpoint 1 = anatomical right; Endpoint 2 = anatomical left",
        })
        : Object.freeze({
          zh: "屏幕有序；解剖侧映射未知",
          en: "Screen-ordered; Anatomical mapping unknown",
        });
    const hasAnatomicalMapping = value.anatomicalSideMapping !== "unknown"
      && value.anatomicalLeftEndpointProgress != null
      && value.anatomicalRightEndpointProgress != null;
    const feedGeometry = value.canonicalFeedMirrored === true
      ? Object.freeze({ zh: "canonical 输入已镜像", en: "canonical feed mirrored" })
      : value.canonicalFeedMirrored === false
        ? Object.freeze({ zh: "canonical 输入未镜像", en: "canonical feed unmirrored" })
        : Object.freeze({ zh: "canonical 镜像状态未知", en: "canonical feed mirroring unknown" });
    const coarseView = value.coarseView ?? "unknown";
    const rawAxis = value.rawBarAxis
      ? value.rawBarAxis.map((entry) => formatEvidenceNumber(entry, 3)).join(" / ")
      : "—";
    return `<div class="coordinate-evidence-card raw-coordinate-evidence">
      <div class="coordinate-evidence-kicker">原始斜视角器械轴 <span>/ Raw oblique equipment axis</span></div>
      <div class="coordinate-evidence-value">${formatEvidenceAngle(value.rawAngleDegrees)}</div>
      <dl><div><dt>图像端点 / Image endpoints</dt><dd>${rawAxis}</dd></div></dl>
    </div>
    <div class="coordinate-evidence-card canonical-coordinate-evidence">
      <div class="coordinate-evidence-kicker">规范局部轨迹 <span>/ Canonical local-frame trajectory</span></div>
      <div class="coordinate-evidence-metrics">
        ${evidenceMetric("沿轴进度", "Along-axis progress", value.equipmentProgress)}
        ${evidenceMetric("横轴偏移", "Cross-axis displacement", value.equipmentCrossAxisDisplacement)}
        ${evidenceMetric("动态轴角", "Baseline-corrected angle", value.correctedAngleDegrees, "angle")}
      </div>
      <div class="coordinate-evidence-metrics channel-quality-metrics">
        ${evidenceMetric("器械覆盖率", "Equipment coverage", value.equipmentCoverage, "percent")}
        ${evidenceMetric("器械不确定度", "Equipment uncertainty", value.equipmentUncertainty, "percent")}
        ${evidenceMetric("骨架覆盖率", "Pose coverage", value.poseCoverage, "percent")}
        ${evidenceMetric("骨架不确定度", "Pose uncertainty", value.poseUncertainty, "percent")}
      </div>
    </div>
    <div class="coordinate-evidence-card calibration-coordinate-evidence">
      <div class="coordinate-evidence-kicker">校准状态 <span>/ Calibration</span></div>
      <div class="coordinate-state-line"><strong>${escapeHtml(state.zh)}</strong><span>${escapeHtml(state.en)}</span></div>
      <dl>
        <div><dt>原因 / Reason</dt><dd>${escapeHtml(reason.zh)}<span>${escapeHtml(reason.en)}</span></dd></div>
        <div><dt>融合 / Fusion</dt><dd>${escapeHtml(fusion.zh)}<span>${escapeHtml(fusion.en)}</span></dd></div>
        <div><dt>坐标 / Scale / Confidence</dt><dd>#${escapeHtml(value.coordinateFrameId ?? "—")} · ${escapeHtml(value.scaleSource ?? "—")} ${formatEvidenceNumber(value.scale, 3)} · ${formatEvidencePercent(value.confidence)}</dd></div>
      </dl>
    </div>
    <div class="coordinate-evidence-card endpoint-coordinate-evidence">
      <div class="coordinate-evidence-kicker">端点进度与残差 <span>/ Endpoint progress and residual</span></div>
      <div class="endpoint-mapping"><strong>${escapeHtml(endpointMapping.zh)}</strong><span>${escapeHtml(endpointMapping.en)}</span></div>
      <dl><div><dt>机位与输入 / View and feed</dt><dd>${escapeHtml(coarseView)} · ${escapeHtml(feedGeometry.zh)}<span>${escapeHtml(feedGeometry.en)}</span></dd></div></dl>
      <div class="coordinate-evidence-metrics endpoint-metrics">
        ${hasAnatomicalMapping
          ? `${evidenceMetric("解剖左侧端点", "Anatomical left endpoint", value.anatomicalLeftEndpointProgress)}
             ${evidenceMetric("解剖右侧端点", "Anatomical right endpoint", value.anatomicalRightEndpointProgress)}`
          : `${evidenceMetric("屏幕有序端点 1", "Screen-ordered endpoint 1", value.endpointOneProgress)}
             ${evidenceMetric("屏幕有序端点 2", "Screen-ordered endpoint 2", value.endpointTwoProgress)}`}
        ${evidenceMetric("原始端点残差 P2 − P1", "Raw endpoint residual P2 − P1", value.endpointResidual)}
      </div>
      <p>${hasAnatomicalMapping
        ? "解剖侧由 Rust 使用端点顺序、粗机位与 canonical feed 镜像声明共同确定。<span>Anatomical side is determined in Rust from endpoint order, coarse view and canonical-feed mirroring.</span>"
        : "上下文不足，端点只保留屏幕轴顺序，不推测人体左右。<span>Context is insufficient; endpoints remain screen-ordered without guessing anatomical side.</span>"}</p>
    </div>`;
  }

  function evidenceMetric(zh, en, value, kind = "number") {
    const formatted = kind === "angle"
      ? formatEvidenceAngle(value)
      : (kind === "percent" ? formatEvidencePercent(value) : formatEvidenceNumber(value, 3));
    return `<div><span>${escapeHtml(zh)}<small>${escapeHtml(en)}</small></span><strong>${formatted}</strong></div>`;
  }

  function bilingualCopy(dictionary, key, fallbackZh, fallbackEn) {
    return dictionary[String(key)] || Object.freeze({ zh: fallbackZh, en: fallbackEn });
  }

  function finiteOrNull(value) {
    return Number.isFinite(value) ? Number(value) : null;
  }

  function roundNumber(value, digits) {
    if (!Number.isFinite(value)) return null;
    const scale = 10 ** digits;
    const rounded = Math.round((Number(value) + Number.EPSILON) * scale) / scale;
    return Object.is(rounded, -0) ? 0 : rounded;
  }

  function radiansToRoundedDegrees(value) {
    return Number.isFinite(value) ? roundNumber(Number(value) * 180 / Math.PI, 2) : null;
  }

  function formatEvidenceNumber(value, digits) {
    return Number.isFinite(value) ? Number(value).toFixed(digits) : "—";
  }

  function formatEvidenceAngle(value) {
    return Number.isFinite(value) ? `${Number(value).toFixed(2)}°` : "—";
  }

  function formatEvidencePercent(value) {
    return Number.isFinite(value) ? `${Math.round(Number(value) * 100)}%` : "—";
  }

  function evidenceLayerControlsHtml() {
    return EVIDENCE_LAYER_DEFINITIONS.map(({ key, label }) => (
      `<button type="button" class="layer-switch active" data-quality-layer="${key}" aria-pressed="true">${label}</button>`
    )).join("");
  }

  function normalizedTrajectoryUntil(frames, timestampMs, channelName) {
    if (!Array.isArray(frames) || !["pose", "equipment"].includes(channelName)) return [];
    return frames
      .filter((frame) => Number.isFinite(frame?.timestampMs) && frame.timestampMs <= timestampMs)
      .map((frame) => normalizedChannelEvidence(localCoordinateOf(frame)?.[channelName], frame.timestampMs))
      .filter(Boolean);
  }

  function legacyEquipmentTrajectoryUntil(trajectories, timestampMs) {
    if (!Array.isArray(trajectories)) return [];
    return trajectories.map((trajectory) => trajectoryUntil(
      trajectory?.points || trajectory?.samples || [],
      timestampMs,
    ).map((point) => {
      const x = point.x ?? point.centerX
        ?? (Number.isFinite(point.x1) && Number.isFinite(point.x2) ? (point.x1 + point.x2) / 2 : null);
      const y = point.y ?? point.centerY
        ?? (Number.isFinite(point.y1) && Number.isFinite(point.y2) ? (point.y1 + point.y2) / 2 : null);
      return Number.isFinite(x) && Number.isFinite(y)
        ? { timestampMs: point.timestampMs, x, y }
        : null;
    }).filter(Boolean)).filter((points) => points.length);
  }

  function isPredictedEvidence(value) {
    if (!value) return false;
    const provenance = String(value.provenance ?? value.source ?? "").toLowerCase();
    return value.predicted === true || provenance.includes("predicted");
  }

  function frameEvidenceLayers(frame) {
    const value = frame || {};
    const inputAxes = Array.isArray(value.inputEquipmentAxes) ? value.inputEquipmentAxes : [];
    const canonicalTracks = canonicalEquipmentTracks(value);
    const hasCanonicalAxis = canonicalTracks.some((track) => equipmentAxisGeometry(track));
    const rawEquipment = hasCanonicalAxis
      ? canonicalTracks
      : (inputAxes.length ? inputAxes : canonicalTracks);
    const canonicalPose = value.landmarks || value.skeleton || [];
    const inputPose = value.inputPose?.landmarks || [];
    const coordinate = localCoordinateOf(value);
    const normalizedPose = normalizedChannelEvidence(coordinate?.pose, value.timestampMs);
    const normalizedEquipment = normalizedChannelEvidence(coordinate?.equipment, value.timestampMs);
    const fusionStatus = fusionEvidence(coordinate);
    return Object.freeze({
      rawSkeleton: Object.freeze({ canonical: canonicalPose, input: inputPose }),
      rawEquipment,
      normalizedPose,
      normalizedEquipment,
      fusionStatus,
      coordinate,
      canonicalPose,
      inputPose,
      equipment: rawEquipment,
    });
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
    const layerSwitches = document.querySelector(".layer-switches");
    if (layerSwitches) layerSwitches.innerHTML = evidenceLayerControlsHtml();
    const state = {
      workspace: null,
      activeItemId: null,
      activeRepId: null,
      activeItem: null,
      activeReview: null,
      evidenceMode: "calibration",
      layers: Object.fromEntries(EVIDENCE_LAYER_DEFINITIONS.map(({ key }) => [key, true])),
    };
    const video = byId("qualityVideo");
    const canvas = byId("qualityOverlay");
    const context = canvas.getContext("2d");
    byId("observationReadout").style.whiteSpace = "pre-line";
    byId("observationReadout").style.maxWidth = "min(92%, 780px)";

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
        let restoredDraft = null;
        let restoreError = null;
        try {
          restoredDraft = restoreLocalDraft(window.localStorage, state.workspace);
        } catch (error) {
          restoreError = error;
        }
        renderReleaseHeader();
        selectItem(state.workspace.release.items[0].itemId);
        byId("qualityLoading").hidden = true;
        byId("qualityApp").hidden = false;
        if (restoreError) {
          setNotice(`本地草稿无法恢复：${restoreError.message || String(restoreError)}。可清除草稿后继续；冻结提案未被修改。`, "error");
        } else if (restoredDraft?.restored) {
          setNotice(`已从此浏览器恢复本地草稿（${restoredDraft.decided} 项）；尚未导出正式文件。`, "ok");
        } else {
          setNotice("审核会自动保存到此浏览器；只有“导出审核 JSON”才会生成正式文件。", "ok");
        }
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
          <span class="queue-progress">${state.evidenceMode === "calibration" ? `${progress.coreDecided}/${progress.coreTotal} 核心` : `${benchmark?.reps?.length ?? 0} REP`}</span>
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
        const repRows = state.evidenceMode === "calibration"
          ? reviewTargets({ reps: [rep] })
          : [];
        const decisions = state.evidenceMode === "calibration"
          ? state.activeReview.listDecisions().filter((decision) => (
            decision.target.repId === rep.repId
            && repRows.some((row) => row.priority === "core"
              && reviewTargetKey(row.target) === reviewTargetKey(decision.target))
          )).length
          : 0;
        const total = repRows.filter((row) => row.priority === "core").length;
        return `<button type="button" class="rep-tab ${rep.repId === state.activeRepId ? "active" : ""}" data-rep-id="${escapeHtml(rep.repId)}">
          <span>REP ${String(index + 1).padStart(2, "0")}</span><small>${state.evidenceMode === "calibration" ? `${decisions}/${total} 核心` : escapeHtml(rep.disposition || "frozen")}</small>
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
        ${endpointDecisionControls(decision)}
      </article>`;
    }

    function conclusionCard(rep, conclusion) {
      const target = { kind: "conclusion", repId: rep.repId, conclusionId: conclusion.conclusionId };
      const decision = state.activeReview.getDecision(target);
      const stateValue = conclusion.state ?? conclusion.value ?? "cannot_judge";
      const evidence = Array.isArray(conclusion.evidence) ? conclusion.evidence : [];
      const copy = QualityReviewI18n.localizeConclusionText(conclusion.text || conclusion.summary || stateValue);
      const stateCopy = QualityReviewI18n.localizeConclusionState(stateValue);
      const reason = QualityReviewI18n.localizeConclusionReason(conclusion.reason);
      const priority = conclusionReviewPriority(conclusion);
      return `<article class="review-card conclusion-card ${priority === "known_gap" ? "known-gap" : ""}" data-kind="conclusion" data-rep-id="${escapeHtml(rep.repId)}" data-conclusion-id="${escapeHtml(conclusion.conclusionId)}" data-review-priority="${priority}">
        <div class="conclusion-head"><div><span class="dimension">${escapeHtml(dimensionLabel(conclusion.dimension))}${priority === "known_gap" ? '<b class="review-priority optional">当前引擎已知缺口 · 可选审核</b>' : '<b class="review-priority core">核心必审</b>'}</span><h3 class="conclusion-copy ${copy.translated ? "" : "translation-missing"}"><span class="conclusion-copy-zh" lang="zh-CN">${escapeHtml(copy.zh)}</span><span class="conclusion-copy-en" lang="en">${escapeHtml(copy.en)}</span></h3></div><span class="confidence" title="Rust 提案置信度；审核人不需要判断这个百分比是否精确">RUST ${formatConfidence(conclusion.confidence)}</span></div>
        <p class="conclusion-state ${escapeHtml(stateValue)} ${stateCopy.translated ? "" : "translation-missing"}"><span lang="zh-CN">${escapeHtml(stateCopy.zh)}</span><span class="conclusion-state-en" lang="en">${escapeHtml(stateCopy.en)}</span></p>
        ${reason.en ? `<p class="conclusion-reason ${reason.translated ? "" : "translation-missing"}"><span lang="zh-CN">${escapeHtml(reason.zh)}</span><span lang="en">${escapeHtml(reason.en)}</span></p>` : ""}
        ${evidence.length ? `<div class="evidence-list">${evidence.map((entry) => `<code>${escapeHtml(typeof entry === "string" ? entry : JSON.stringify(entry))}</code>`).join("")}</div>` : "<p class=muted>没有额外证据引用</p>"}
        ${conclusion.dimension === "observation_confidence" ? '<p class="review-hint">这里只审核“证据是否足以支持结论”，不要求人工判断置信度百分比是否精确。</p>' : ""}
        ${conclusionDecisionControls(decision)}
      </article>`;
    }

    function verdictButtons(decision, labels) {
      return ["correct", "incorrect", "cannot_judge"].map((verdict) => `<button type="button" class="verdict ${decision?.verdict === verdict ? `selected ${verdict}` : ""}" data-verdict="${verdict}">${labels[verdict]}</button>`).join("");
    }

    function endpointDecisionControls(decision) {
      return `<div class="decision-grid">
        <div class="verdicts" role="group" aria-label="审核结论">
          ${verdictButtons(decision, { correct: "端点正确", incorrect: "端点错误", cannot_judge: "端点无法判断" })}
        </div>
        <label class="field"><span>端点修正 ms</span><input class="correction-input" type="number" value="${escapeHtml(decision?.correctedValue?.occurredAtMs ?? "")}" placeholder="可留空"></label>
        <label class="field note-field"><span>审核备注</span><input class="note-input" type="text" value="${escapeHtml(decision?.note || "")}" placeholder="可选"></label>
        ${decision ? '<button type="button" class="clear-decision" data-clear-decision>撤销本项审核</button>' : ""}
      </div>`;
    }

    function conclusionDecisionControls(decision) {
      const correction = correctionSelection(decision?.correctedValue);
      const stateOptions = ['<option value="">正确状态（错误时可选）</option>', ...CORRECTED_CONCLUSION_STATES.map((entry) => (
        `<option value="${entry.value}" ${correction.expectedState === entry.value ? "selected" : ""}>${entry.label}</option>`
      ))].join("");
      const issueOptions = ['<option value="">错误/无法判断原因（可选）</option>', ...REVIEW_ISSUE_CODES.map((entry) => (
        `<option value="${entry.value}" ${correction.issueCode === entry.value ? "selected" : ""}>${entry.label}</option>`
      ))].join("");
      return `<div class="decision-grid conclusion-decision-grid">
        <div class="verdicts" role="group" aria-label="审核结论">
          ${verdictButtons(decision, { correct: "结论正确", incorrect: "结论错误", cannot_judge: "审核证据不足" })}
        </div>
        <label class="field"><span>正确结论状态</span><select class="correction-state">${stateOptions}</select></label>
        <label class="field"><span>错误定位</span><select class="issue-code">${issueOptions}</select></label>
        <label class="field note-field full-field"><span>审核备注</span><input class="note-input" type="text" value="${escapeHtml(decision?.note || "")}" placeholder="只有需要补充时填写"></label>
        ${decision ? '<button type="button" class="clear-decision" data-clear-decision>撤销本项审核</button>' : ""}
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
            correctedValue: button.dataset.verdict === "correct" ? null : draft.correctedValue,
            note: draft.note,
          });
          persistLocalDraft();
          renderQueue();
          renderRepTabs();
          renderReviewPanel();
          renderProgress();
        }));
        card.querySelectorAll(".correction-input, .correction-state, .issue-code, .note-input").forEach((input) => {
          const syncDraft = () => {
            const target = reviewTargetForCard(card);
            const existing = state.activeReview.getDecision(target);
            if (!existing) return;
            const draft = reviewDraftForCard(card);
            if (draft.error) {
              setNotice("端点修正必须是毫秒数", "error");
              return;
            }
            syncExistingDecisionDraft(state.activeReview, target, {
              ...draft,
              correctedValue: existing.verdict === "correct" ? null : draft.correctedValue,
            });
            persistLocalDraft();
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
        const clear = card.querySelector("[data-clear-decision]");
        if (clear) clear.addEventListener("click", () => {
          state.activeReview.clearDecision(reviewTargetForCard(card));
          persistLocalDraft();
          renderQueue();
          renderRepTabs();
          renderReviewPanel();
          renderProgress();
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
      const correctionState = card.querySelector(".correction-state");
      const issueCode = card.querySelector(".issue-code");
      const noteInput = card.querySelector(".note-input");
      const correctedValue = card.dataset.kind === "endpoint"
        ? (correctionInput?.value.trim() ? { occurredAtMs: Math.round(Number(correctionInput.value)) } : null)
        : structuredConclusionCorrection(correctionState?.value, issueCode?.value);
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
      byId("reviewProgressText").textContent = `核心 ${progress.coreDecided} / ${progress.coreTotal} · 全部 ${progress.decided} / ${progress.total}`;
      byId("reviewProgressBar").style.width = `${progress.coreTotal ? progress.coreDecided / progress.coreTotal * 100 : 0}%`;
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
      const layers = frameEvidenceLayers(frame);
      if (frame && state.layers.rawSkeleton) {
        drawSkeleton(layers.inputPose, transform, "input");
        drawSkeleton(layers.canonicalPose, transform, "canonical");
      }
      if (state.layers.rawEquipment) {
        drawLegacyEquipmentTrajectories(evidence.equipmentTrajectories || [], currentMs, transform);
        if (frame) drawEquipment(layers.rawEquipment, transform);
      }
      if (state.layers.normalizedPose || state.layers.normalizedEquipment) {
        drawNormalizedEvidence({
          frames: evidence.frames || [],
          currentMs,
          width,
          height,
          showPose: state.layers.normalizedPose,
          showEquipment: state.layers.normalizedEquipment,
        });
      }
      const canonicalVisible = layers.canonicalPose.filter(isVisiblePoint).length;
      const inputVisible = layers.inputPose.filter(isVisiblePoint).length;
      const equipmentCount = layers.rawEquipment.length;
      const coordinateReadout = `\n${coordinateStatusText(layers.coordinate, state.layers.fusionStatus)}`;
      byId("observationReadout").textContent = frame
        ? `OBS ${formatMs(frame.timestampMs)} · POSE INPUT ${inputVisible} / RUST ${canonicalVisible} · EQUIPMENT ${equipmentCount}${coordinateReadout}`
        : "OBSERVATION UNKNOWN · no frame within 150 ms";
      byId("coordinateEvidencePanel").innerHTML = coordinateEvidenceHtml(
        coordinateEvidenceSummary(layers.coordinate),
      );
    }

    function drawSkeleton(points, transform, mode) {
      if (!points.some(isVisiblePoint)) return;
      const input = mode === "input";
      context.save();
      context.lineCap = "round";
      context.lineJoin = "round";
      context.lineWidth = input ? 1.8 : 2.4;
      for (const [from, to] of HALPE26_EDGES) {
        const a = points[from];
        const b = points[to];
        if (!isVisiblePoint(a) || !isVisiblePoint(b)) continue;
        const pa = mapPoint(a, transform);
        const pb = mapPoint(b, transform);
        const predicted = isPredictedEvidence(a) || isPredictedEvidence(b);
        context.setLineDash(input ? [5, 4] : (predicted ? [6, 5] : []));
        context.strokeStyle = predicted
          ? "rgba(255,104,72,.92)"
          : (input ? "rgba(85,220,231,.72)" : "rgba(202,255,57,.92)");
        context.beginPath(); context.moveTo(pa.x, pa.y); context.lineTo(pb.x, pb.y); context.stroke();
      }
      context.setLineDash([]);
      points.forEach((point) => {
        if (!isVisiblePoint(point)) return;
        const position = mapPoint(point, transform);
        const predicted = isPredictedEvidence(point);
        context.fillStyle = predicted
          ? "#ff6848"
          : (input ? "rgba(85,220,231,.82)" : "#f7f7ed");
        context.beginPath(); context.arc(position.x, position.y, input ? 2.2 : 3.2, 0, Math.PI * 2); context.fill();
        if (predicted) {
          context.fillStyle = "#ff6848";
          context.font = "800 8px ui-monospace, monospace";
          context.fillText("P", position.x + 5, position.y - 5);
        }
      });
      context.restore();
    }

    function drawEquipment(observations, transform) {
      context.save();
      context.lineCap = "round";
      observations.forEach((observation) => {
        const axis = equipmentAxisGeometry(observation);
        const predicted = isPredictedEvidence(observation) || isPredictedEvidence(observation?.axis);
        context.setLineDash(predicted ? [7, 5] : []);
        if (axis) {
          const a = mapPoint({ x: axis.x1, y: axis.y1 }, transform);
          const b = mapPoint({ x: axis.x2, y: axis.y2 }, transform);
          context.strokeStyle = "rgba(0,0,0,.72)"; context.lineWidth = 8;
          context.beginPath(); context.moveTo(a.x, a.y); context.lineTo(b.x, b.y); context.stroke();
          context.strokeStyle = predicted ? "#ff6848" : "#ffd84a"; context.lineWidth = 3;
          context.beginPath(); context.moveTo(a.x, a.y); context.lineTo(b.x, b.y); context.stroke();
          if (predicted) {
            context.fillStyle = "#ff6848";
            context.font = "800 9px ui-monospace, monospace";
            context.fillText("PREDICTED", (a.x + b.x) / 2 + 8, (a.y + b.y) / 2 - 8);
          }
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

    function drawLegacyEquipmentTrajectories(trajectories, currentMs, transform) {
      context.save();
      legacyEquipmentTrajectoryUntil(trajectories, currentMs).forEach((points, index) => {
        drawPath(points, transform, index % 2 ? "rgba(85,220,231,.8)" : "rgba(255,216,74,.85)", 2);
      });
      context.restore();
    }

    function drawNormalizedEvidence({ frames, currentMs, width, height, showPose, showEquipment }) {
      const pose = showPose ? normalizedTrajectoryUntil(frames, currentMs, "pose") : [];
      const equipment = showEquipment ? normalizedTrajectoryUntil(frames, currentMs, "equipment") : [];
      if (!pose.length && !equipment.length) return;
      const size = Math.max(112, Math.min(176, width * 0.22, height * 0.28));
      const left = 18;
      const top = Math.max(58, height - size - 18);
      const panel = {
        renderedWidth: size,
        renderedHeight: size,
        offsetX: left,
        offsetY: top,
      };
      context.save();
      context.fillStyle = "rgba(5,7,6,.82)";
      context.strokeStyle = "rgba(202,255,57,.42)";
      context.lineWidth = 1;
      context.fillRect(left, top, size, size);
      context.strokeRect(left, top, size, size);
      context.setLineDash([3, 4]);
      context.strokeStyle = "rgba(247,247,237,.22)";
      context.beginPath();
      context.moveTo(left + size / 2, top); context.lineTo(left + size / 2, top + size);
      context.moveTo(left, top + size / 2); context.lineTo(left + size, top + size / 2);
      context.stroke();
      context.setLineDash([]);
      if (pose.length) drawPath(pose.slice(-180).map((sample) => sample.point), panel, "rgba(85,220,231,.95)", 2.5);
      if (equipment.length) drawPath(equipment.slice(-180).map((sample) => sample.point), panel, "rgba(255,216,74,.95)", 2.5);
      drawPredictedNormalizedSamples(pose, panel);
      drawPredictedNormalizedSamples(equipment, panel);
      context.fillStyle = "#f7f7ed";
      context.font = "800 8px ui-monospace, monospace";
      context.fillText("VIEW-NORMALIZED 2D", left + 7, top + 13);
      if (pose.length) {
        context.fillStyle = "rgba(85,220,231,.95)";
        context.fillText("POSE", left + 7, top + size - 8);
      }
      if (equipment.length) {
        context.fillStyle = "rgba(255,216,74,.95)";
        context.fillText("EQUIPMENT", left + size - 58, top + size - 8);
      }
      context.restore();
    }

    function drawPredictedNormalizedSamples(samples, transform) {
      samples.filter((sample) => sample.predicted).slice(-24).forEach((sample) => {
        const position = mapPoint(sample.point, transform);
        context.fillStyle = "#ff6848";
        context.beginPath(); context.arc(position.x, position.y, 3.2, 0, Math.PI * 2); context.fill();
        context.font = "800 8px ui-monospace, monospace";
        context.fillText("P", position.x + 5, position.y - 4);
      });
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

    function persistLocalDraft() {
      try {
        const saved = saveLocalDraft(window.localStorage, state.workspace);
        setNotice(`已自动保存到此浏览器（${saved.decided} 项）；尚未导出正式文件。`, "ok");
      } catch (error) {
        setNotice(`本地草稿保存失败：${error.message || String(error)}。请及时导出审核 JSON。`, "error");
      }
    }

    function resetLocalDraft() {
      if (!window.confirm("清除本地草稿并重置所有尚未导出的审核决定？")) return;
      const release = state.workspace.release;
      const reviewer = state.workspace.reviewer;
      const activeItemId = state.activeItemId || release.items[0].itemId;
      try {
        clearLocalDraft(window.localStorage, release);
        state.workspace = createWorkspace(release, reviewer);
        renderReleaseHeader();
        selectItem(activeItemId);
        setNotice("本地草稿已清除；当前冻结发布包已恢复为未审核状态。", "ok");
      } catch (error) {
        setNotice(`本地草稿清除失败：${error.message || String(error)}`, "error");
      }
    }

    async function importReviews(file) {
      if (!file) return;
      try {
        state.workspace.importJson(await file.text());
        state.activeReview = state.workspace.review(state.activeItemId);
        renderQueue(); renderRepTabs(); renderReviewPanel(); renderProgress();
        persistLocalDraft();
        setNotice("已导入审核 JSON，并自动保存为此发布包的浏览器本地草稿。", "ok");
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
    byId("qualityClearDraft").addEventListener("click", resetLocalDraft);
    byId("qualityImport").addEventListener("change", (event) => importReviews(event.target.files?.[0]));
    document.querySelectorAll("[data-evidence-mode]").forEach((button) => button.addEventListener("click", () => {
      selectEvidenceMode(button.dataset.evidenceMode);
    }));
    document.querySelectorAll("[data-quality-layer]").forEach((button) => button.addEventListener("click", () => {
      const layer = button.dataset.qualityLayer;
      state.layers[layer] = !state.layers[layer];
      button.classList.toggle("active", state.layers[layer]);
      button.setAttribute("aria-pressed", String(state.layers[layer]));
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

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
    })[character]);
  }

  return {
    benchmarkEvidenceForItem,
    clearLocalDraft,
    coordinateEvidenceHtml,
    coordinateEvidenceSummary,
    coordinateStatusSummary,
    coordinateStatusText,
    correctionSelection,
    conclusionReviewPriority,
    EXPORT_SCHEMA,
    EVIDENCE_LAYER_DEFINITIONS,
    evidenceLayerControlsHtml,
    equipmentAxisGeometry,
    LOCAL_DRAFT_PREFIX,
    RELEASE_SCHEMA,
    createWorkspace,
    dimensionLabel,
    draftStorageKey,
    frameAt,
    frameEvidenceLayers,
    isPredictedEvidence,
    legacyEquipmentTrajectoryUntil,
    lineageSummary,
    mount,
    normalizedTrajectoryUntil,
    restoreLocalDraft,
    saveLocalDraft,
    structuredConclusionCorrection,
    syncExistingDecisionDraft,
    trajectoryUntil,
  };
});
