import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import {
  annotationInboxVideoUrl,
  completeReviewedInboxItem,
  loadAnnotationInbox,
  type AnnotationInboxItem,
} from "../pose/annotationInbox";
import { EXERCISE_REGISTRY, MUSCLE_GROUPS } from "../pose/exerciseRegistry";
import type { CameraView } from "../pose/formRuleEngine";
import { analyzePoseSet } from "../pose/poseSetAnalysis";
import type { PoseEstimate } from "../pose/PoseEngine";
import { segmentRepsAuto } from "../pose/repSegmenter";
import {
  addReviewRange,
  editReviewRange,
  restoreReviewRangeSnapshot,
  timelineTimeAt,
  type ReviewRangeEditMode,
} from "../pose/reviewTimeline";
import { selectTrainingWindow } from "../pose/trainingWindow";
import { reviewedNegativeWindows, type TimeWindow } from "../pose/segmentationTraining";
import {
  buildApprovedLatPulldownTrajectorySample,
  type LatPulldownTrajectorySample,
} from "../pose/trajectoryDataset";
import { CAPTURE_POSITIONS, type CapturePosition } from "../pose/viewGating";
import { extractInboxVideoPoseFixture } from "../pose/inboxVideoPoseExtractor";

interface ImportedLabels {
  exerciseId?: string | null;
  cameraView?: CameraView;
  variation?: string | null;
  trainingSide?: "bilateral" | "left" | "right";
  profileVersion?: string | null;
  model?: string | null;
  capturePosition?: CapturePosition | null;
  labels?: Array<{ repIndex: number; startMs: number; extremeMs: number; endMs: number }>;
}

interface ImportedCaptureMetadata {
  exerciseId?: string | null;
  cameraView?: CameraView;
  variation?: string | null;
  trainingSide?: "bilateral" | "left" | "right";
  profileVersion?: string | null;
  model?: string | null;
  capturePosition?: CapturePosition | null;
  rustNeedsReviewReps?: Array<ImportedRustCandidate>;
  rustRejectedReps?: Array<ImportedRustCandidate>;
  motionVersions?: {
    contract?: { major?: number; minor?: number };
    algorithm?: string;
    config?: string;
    inference?: string;
    activeProfileIdentity?: string | null;
    activeProfileHash?: string | null;
  };
  referenceComparison?: { status?: string; profileIdentity?: string | null } | null;
}

interface ImportedRustCandidate {
  repId?: string;
  startTimestampMs?: number;
  peakTimestampMs?: number;
  endTimestampMs?: number;
  evidenceReason?: string | null;
}

interface ImportedFixture {
  video: string;
  durationSec: number;
  stepMs?: number;
  model?: string;
  poses: PoseEstimate[];
}

interface ReviewCapture {
  id: string;
  videoUrl: string;
  sourceSignature: string;
  revokeVideoUrl: boolean;
  fixture: ImportedFixture;
  labels: ImportedLabels | null;
  metadata: ImportedCaptureMetadata | null;
  sourceKind: "project" | "directory" | "manual" | "inbox";
  inboxItem?: AnnotationInboxItem;
}

interface ProjectManifest {
  captures: Array<{ id: string; video: string; keypoints: string; labels?: string; metadata?: string }>;
}

interface TrajectoryDatasetDecision {
  decision: "eligible" | "quarantined";
  reason: string | null;
  sample: LatPulldownTrajectorySample | null;
  recordedAt: string;
}

interface Approval {
  expectedCount: string;
  candidateId: string;
  candidateCount: number;
  exerciseId: string;
  cameraView: CameraView;
  variation: string | null;
  trainingSide: "bilateral" | "left" | "right" | null;
  profileVersion: string | null;
  model: string;
  approvedSegments: Candidate["segments"];
  approvedAt: string;
  note?: string;
  /** Exact physical placement, not only its reduced rule-engine view. */
  capturePosition?: CapturePosition | null;
  /** Stored at approval time so source reloads cannot silently rewrite a label. */
  trajectoryDataset?: TrajectoryDatasetDecision | null;
  /** Immutable local audit trail. The top-level fields remain the latest approved version for legacy exports. */
  analysisVersions?: readonly ReviewAnalysisVersion[];
}

interface ReviewAnalysisVersion {
  version: number;
  approvedAt: string;
  sourceSignature: string;
  canonicalPoseFrameCount: number;
  expectedCount: string;
  candidateId: string;
  approvedSegments: Candidate["segments"];
  weakNegativeWindows: TimeWindow[];
  recognitionSnapshot: {
    motionVersions: ImportedCaptureMetadata["motionVersions"] | null;
    referenceStatus: string | null;
    needsReviewCandidateCount: number;
    rejectedCandidateCount: number;
  };
  note?: string;
  algorithmVersion: "reviewed-canonical-replay/v1";
}

interface ReviewDraft {
  exerciseId: string;
  cameraView: CameraView;
  capturePosition: CapturePosition | "";
  expectedCount: string;
  draftCandidateId: string | null;
  draftSegments: Candidate["segments"];
  segmentUndoStack?: Candidate["segments"][];
  note: string;
  updatedAt: string;
}

interface Candidate {
  id: string;
  label: string;
  count: number;
  score: string;
  reason: string;
  segments: Array<{ repIndex: number; startMs: number; peakMs: number; endMs: number; note?: string }>;
  tone: "recorded" | "current" | "caution";
}

interface ReviewRangeDrag {
  pointerId: number;
  anchorMs: number;
  focusMs: number;
}

interface ReviewSegmentEdit {
  pointerId: number;
  repIndex: number;
  mode: ReviewRangeEditMode;
  pointerOriginMs: number;
  original: Candidate["segments"][number];
  historyCaptured: boolean;
}

interface ReplayReportRow {
  capture: ReviewCapture;
  quality: ReturnType<typeof qualityOf>;
  historicalCount: number | null;
  currentCount: number | null;
  stableCount: number | null;
  automaticCount: number;
  excludedFrames: number;
  priority: "high" | "normal" | "low";
  reason: string;
}

interface DirectoryFileHandle {
  kind: "file";
  name: string;
  getFile(): Promise<File>;
}

interface DirectoryHandle {
  values(): AsyncIterableIterator<DirectoryFileHandle>;
  queryPermission?: (descriptor?: { mode: "read" }) => Promise<"granted" | "denied" | "prompt">;
}

const APPROVAL_KEY = "form-coach-capture-approvals/v1";
const DRAFT_KEY = "form-coach-capture-review-drafts/v1";
const SOURCE_DATABASE = "form-coach-review-source";
const SOURCE_STORE = "settings";
const SOURCE_KEY = "downloads-directory";
function analysisViewFor(position: CapturePosition | ""): CameraView | null {
  return CAPTURE_POSITIONS.find((item) => item.id === position)?.analysisView ?? null;
}

function importedCapturePosition(value: unknown): CapturePosition | "" {
  return CAPTURE_POSITIONS.some((item) => item.id === value) ? value as CapturePosition : "";
}

function approvalValidationError(input: {
  exerciseId: string;
  capturePosition: CapturePosition | "";
  expectedCount: string;
  segments: readonly Candidate["segments"][number][];
  poses: readonly PoseEstimate[];
}): string | null {
  if (!input.exerciseId) return "请先确认本组动作。";
  if (!input.capturePosition) return "请确认实际八向机位。";
  const actualCount = Number(input.expectedCount);
  if (!Number.isInteger(actualCount) || actualCount <= 0) return "实际次数必须是大于 0 的整数。";
  if (actualCount !== input.segments.length) return `实际次数 ${actualCount} 与逐 rep 边界数 ${input.segments.length} 不一致。`;
  if (input.poses.length < 2) return "关键点帧不足，不能批准本组真值。";
  const startBound = input.poses[0].timestampMs;
  const endBound = input.poses[input.poses.length - 1].timestampMs;
  let previousEnd = -Infinity;
  let previousRepIndex = 0;
  for (const segment of input.segments) {
    if (
      !Number.isInteger(segment.repIndex) ||
      segment.repIndex <= previousRepIndex ||
      ![segment.startMs, segment.peakMs, segment.endMs].every(Number.isFinite) ||
      segment.startMs < startBound ||
      segment.startMs > segment.peakMs ||
      segment.peakMs > segment.endMs ||
      segment.endMs > endBound ||
      segment.startMs < previousEnd
    ) {
      return "逐 rep 边界必须按时间和 rep 编号严格递增，并落在录像范围内。";
    }
    previousEnd = segment.endMs;
    previousRepIndex = segment.repIndex;
  }
  return null;
}

function baseName(name: string): string {
  return name.replace(/\.labels\.json$/i, "").replace(/\.(webm|mp4|mov|json)$/i, "");
}

function formatTimelineTime(timestampMs: number): string {
  const totalSeconds = Math.max(0, timestampMs) / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = (totalSeconds % 60).toFixed(1).padStart(4, "0");
  return `${minutes}:${seconds}`;
}

function downloadJson(value: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function loadApprovals(): Record<string, Approval> {
  try {
    return JSON.parse(localStorage.getItem(APPROVAL_KEY) ?? "{}") as Record<string, Approval>;
  } catch {
    return {};
  }
}

function loadDrafts(): Record<string, ReviewDraft> {
  try {
    return JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "{}") as Record<string, ReviewDraft>;
  } catch {
    return {};
  }
}

function saveDrafts(drafts: Record<string, ReviewDraft>): void {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(drafts));
  } catch {
    // The approval flow remains usable if the browser has disabled local storage.
  }
}

function qualityOf(poses: PoseEstimate[]) {
  const present = poses.filter((pose) => pose.landmarks.length > 0).length;
  const torso = poses.filter((pose) =>
    [11, 12, 23, 24].every((index) => (pose.landmarks[index]?.visibility ?? 0) >= 0.5),
  ).length;
  return {
    frames: poses.length,
    posePercent: poses.length ? Math.round((present / poses.length) * 100) : 0,
    torsoPercent: poses.length ? Math.round((torso / poses.length) * 100) : 0,
  };
}

function candidatesFor(capture: ReviewCapture, exerciseId: string, cameraView: CameraView): Candidate[] {
  const raw = capture.fixture.poses;
  const stable = selectTrainingWindow(raw);
  const recorded = capture.labels?.labels ?? [];
  const toCandidate = (id: string, label: string, poses: PoseEstimate[], tone: Candidate["tone"]): Candidate => {
    if (!exerciseId) {
      return { id, label, count: 0, score: "等待动作", reason: "请先确认本组动作", segments: [], tone };
    }
    const analysis = analyzePoseSet({
      poses,
      cameraView,
      exercise: { mode: "user", exerciseId },
    });
    return {
      id,
      label,
      count: analysis.segments.length,
      score: analysis.score?.score === null || analysis.score?.score === undefined
        ? analysis.score?.label ?? "无评分"
        : `${analysis.score.score} 分`,
      reason: analysis.reason ?? (analysis.segments.length ? "可进入逐 rep 审核" : "没有形成完整周期"),
      segments: analysis.segments,
      tone,
    };
  };
  // Entry/exit trimming was calibrated for upright field captures. The inbox
  // includes supine bench press and push-up footage, where that heuristic can
  // discard the whole working set; keep the complete Rust-canonical replay as
  // the action-agnostic annotation suggestion.
  const automatic = segmentRepsAuto(capture.inboxItem ? raw : stable.poses);
  const rustNeedsReview = (capture.metadata?.rustNeedsReviewReps ?? [])
    .filter((candidate) => [candidate.startTimestampMs, candidate.peakTimestampMs, candidate.endTimestampMs].every(Number.isFinite));
  const rustReviewCandidate: Candidate | null = rustNeedsReview.length
    ? {
        id: "rust_needs_review",
        label: "Rust 待审核候选（不计正式次数）",
        count: rustNeedsReview.length,
        score: "需要人工裁决",
        reason: `原因：${[...new Set(rustNeedsReview.map((candidate) => candidate.evidenceReason ?? "短暂丢点恢复"))].join("、")}`,
        segments: rustNeedsReview.map((candidate, index) => ({
          repIndex: index + 1,
          startMs: candidate.startTimestampMs!,
          peakMs: candidate.peakTimestampMs!,
          endMs: candidate.endTimestampMs!,
        })),
        tone: "caution",
      }
    : null;
  return [
    {
      id: "recorded",
      label: "录制时结果",
      count: recorded.length,
      score: capture.labels?.exerciseId ?? "没有历史标签",
      reason: recorded.length ? "原始录制已经固化的分段" : "录制时没有生成可审批的标签",
      segments: recorded.map((segment) => ({
        repIndex: segment.repIndex,
        startMs: segment.startMs,
        peakMs: segment.extremeMs,
        endMs: segment.endMs,
      })),
      tone: "recorded",
    },
    toCandidate("raw", "当前规则 · 全部帧", raw, "caution"),
    toCandidate("stable", `当前规则 · 稳定段（排除 ${stable.excludedPoseCount} 帧）`, stable.poses, "current"),
    ...(rustReviewCandidate ? [rustReviewCandidate] : []),
    {
      id: "auto",
      label: "动作无关 · 自动周期",
      count: automatic.cycles.length,
      score: automatic.signal ?? "没有信号",
      reason: automatic.signal
        ? `周期强度 ${automatic.periodStrength?.toFixed(2) ?? "—"}；只用于交叉核验，不决定动作名称。`
        : "关键点不足，无法抽取稳定周期。",
      segments: automatic.cycles.map((cycle) => ({
        repIndex: cycle.index,
        startMs: cycle.startMs,
        peakMs: cycle.extremeMs,
        endMs: cycle.endMs,
      })),
      tone: "caution",
    },
  ];
}

/**
 * A compact, live version of the offline replay report.  It deliberately runs
 * the exact candidate builder used by the approval cards, so the dashboard
 * never shows a count that differs from the one an athlete can approve.
 */
function replayReportFor(captures: ReviewCapture[]): ReplayReportRow[] {
  return captures.map((capture): ReplayReportRow => {
    const quality = qualityOf(capture.fixture.poses);
    const exerciseId = capture.labels?.exerciseId ?? "";
    const cameraView = capture.labels?.cameraView ?? "oblique45";
    const candidates = candidatesFor(capture, exerciseId, cameraView);
    const historical = candidates.find((candidate) => candidate.id === "recorded")?.count ?? null;
    const current = candidates.find((candidate) => candidate.id === "raw")?.count ?? null;
    const stable = candidates.find((candidate) => candidate.id === "stable")?.count ?? null;
    const automatic = candidates.find((candidate) => candidate.id === "auto")?.count ?? 0;
    const excludedFrames = selectTrainingWindow(capture.fixture.poses).excludedPoseCount;
    if (!exerciseId) {
      return { capture, quality, historicalCount: null, currentCount: null, stableCount: null, automaticCount: automatic, excludedFrames, priority: "high", reason: "缺少动作标签，专项规则未运行。" };
    }
    if (quality.posePercent < 90 || quality.torsoPercent < 85) {
      return { capture, quality, historicalCount: historical, currentCount: current, stableCount: stable, automaticCount: automatic, excludedFrames, priority: "high", reason: "骨架或躯干覆盖不足，候选不能直接当真值。" };
    }
    if (stable !== historical || stable !== automatic) {
      return { capture, quality, historicalCount: historical, currentCount: current, stableCount: stable, automaticCount: automatic, excludedFrames, priority: "high", reason: "候选计数不一致，需要播放视频裁决。" };
    }
    if (excludedFrames > 0) {
      return { capture, quality, historicalCount: historical, currentCount: current, stableCount: stable, automaticCount: automatic, excludedFrames, priority: "normal", reason: "稳定窗口已排除进出机位帧。" };
    }
    return { capture, quality, historicalCount: historical, currentCount: current, stableCount: stable, automaticCount: automatic, excludedFrames, priority: "low", reason: "三种候选一致；仍请确认实际次数。" };
  }).sort((a, b) => {
    const weight = { high: 0, normal: 1, low: 2 };
    return weight[a.priority] - weight[b.priority] || b.capture.id.localeCompare(a.capture.id);
  });
}

async function parseCaptureFiles(
  files: File[],
  sourceKind: ReviewCapture["sourceKind"] = "manual",
): Promise<ReviewCapture[]> {
  const byName = new Map(files.map((file) => [file.name, file]));
  const fixtures = files.filter((file) => /\.json$/i.test(file.name) && !/\.(labels|metadata)\.json$/i.test(file.name));
  const captures: ReviewCapture[] = [];
  for (const fixtureFile of fixtures) {
    try {
      const parsed = JSON.parse(await fixtureFile.text()) as ImportedFixture[];
      const fixture = parsed[0];
      if (!fixture || !Array.isArray(fixture.poses)) continue;
      const id = baseName(fixtureFile.name);
      const videoFile = ["webm", "mp4", "mov"]
        .map((extension) => byName.get(`${id}.${extension}`))
        .find((file): file is File => !!file);
      if (!videoFile) continue;
      const labelsFile = byName.get(`${id}.labels.json`);
      const metadataFile = byName.get(`${id}.metadata.json`);
      const metadata = metadataFile ? JSON.parse(await metadataFile.text()) as ImportedCaptureMetadata : null;
      const importedLabels = labelsFile ? JSON.parse(await labelsFile.text()) as ImportedLabels : null;
      const labels = importedLabels
        ? { ...metadata, ...importedLabels }
        : metadata?.exerciseId
          ? { ...metadata, exerciseId: metadata.exerciseId }
          : null;
      captures.push({
        id,
        videoUrl: URL.createObjectURL(videoFile),
        sourceSignature: `${videoFile.name}:${videoFile.size}:${videoFile.lastModified}`,
        revokeVideoUrl: true,
        fixture,
        labels,
        metadata,
        sourceKind,
      });
    } catch {
      // A non-capture JSON in Downloads is not a review failure.
    }
  }
  return captures.sort((a, b) => b.id.localeCompare(a.id));
}

async function loadProjectCaptures(): Promise<ReviewCapture[]> {
  const manifestResponse = await fetch("/archives/confirmed-captures/manifest.json", { cache: "no-store" });
  if (!manifestResponse.ok) throw new Error("项目采集库清单不可用");
  const manifest = await manifestResponse.json() as ProjectManifest;
  const captures = await Promise.all(
    manifest.captures.map(async (entry) => {
      const fixtureResponse = await fetch(`/archives/confirmed-captures/${entry.keypoints}`, { cache: "no-store" });
      if (!fixtureResponse.ok) throw new Error(`无法读取 ${entry.keypoints}`);
      const parsed = await fixtureResponse.json() as ImportedFixture[];
      const labels = entry.labels
        ? await fetch(`/archives/confirmed-captures/${entry.labels}`, { cache: "no-store" }).then(async (response) =>
            response.ok ? await response.json() as ImportedLabels : null,
          )
        : null;
      const metadata = entry.metadata
        ? await fetch(`/archives/confirmed-captures/${entry.metadata}`, { cache: "no-store" }).then(async (response) =>
            response.ok ? await response.json() as ImportedCaptureMetadata : null,
          )
        : null;
      const fixture = parsed[0];
      if (!fixture || !Array.isArray(fixture.poses)) throw new Error(`采集关键点格式无效: ${entry.id}`);
      return {
        id: entry.id,
        videoUrl: `/archives/confirmed-captures/${entry.video}`,
        sourceSignature: entry.id,
        revokeVideoUrl: false,
        fixture,
        labels: labels ? { ...metadata, ...labels } : metadata?.exerciseId ? metadata : null,
        metadata,
        sourceKind: "project",
      } satisfies ReviewCapture;
    }),
  );
  return captures.sort((a, b) => b.id.localeCompare(a.id));
}

function openSourceDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(SOURCE_DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(SOURCE_STORE)) {
        request.result.createObjectStore(SOURCE_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("无法读取本机采集目录授权"));
  });
}

async function persistDirectory(directory: DirectoryHandle): Promise<void> {
  const database = await openSourceDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(SOURCE_STORE, "readwrite");
    transaction.objectStore(SOURCE_STORE).put(directory, SOURCE_KEY);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("无法保存本机采集目录授权"));
  });
  database.close();
}

async function restoreDirectory(): Promise<DirectoryHandle | null> {
  const database = await openSourceDatabase();
  const handle = await new Promise<DirectoryHandle | null>((resolve, reject) => {
    const request = database.transaction(SOURCE_STORE, "readonly").objectStore(SOURCE_STORE).get(SOURCE_KEY);
    request.onsuccess = () => resolve((request.result as DirectoryHandle | undefined) ?? null);
    request.onerror = () => reject(request.error ?? new Error("无法恢复本机采集目录授权"));
  });
  database.close();
  return handle;
}

async function filesFromDirectory(directory: DirectoryHandle): Promise<File[]> {
  const files: File[] = [];
  for await (const entry of directory.values()) {
    if (entry.kind === "file" && /field-capture-.*\.(json|webm|mp4|mov)$/i.test(entry.name)) {
      files.push(await entry.getFile());
    }
  }
  return files;
}

/**
 * Local-only evidence board. The athlete compares deterministic replays and
 * explicitly approves a ground-truth count; nothing is uploaded.
 */
export function CaptureApprovalPanel({ compact = false }: { compact?: boolean }) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const reviewVideoRef = useRef<HTMLVideoElement | null>(null);
  const timelineTrackRef = useRef<HTMLDivElement | null>(null);
  const rangeDragRef = useRef<ReviewRangeDrag | null>(null);
  const segmentEditRef = useRef<ReviewSegmentEdit | null>(null);
  const capturesRef = useRef<ReviewCapture[]>([]);
  const selectedIdRef = useRef<string | null>(null);
  const approvalsRef = useRef<Record<string, Approval>>(loadApprovals());
  const draftsRef = useRef<Record<string, ReviewDraft>>(loadDrafts());
  const inboxItemsRef = useRef<readonly AnnotationInboxItem[]>([]);
  const processingInboxIdsRef = useRef(new Set<string>());
  const inboxInitializedRef = useRef(false);
  const [captures, setCaptures] = useState<ReviewCapture[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inboxWarning, setInboxWarning] = useState<string | null>(null);
  const [approvals, setApprovals] = useState<Record<string, Approval>>(approvalsRef.current);
  const [exerciseId, setExerciseId] = useState("");
  const [cameraView, setCameraView] = useState<CameraView>("oblique45");
  const [capturePosition, setCapturePosition] = useState<CapturePosition | "">("");
  const [expectedCount, setExpectedCount] = useState("");
  const [draftSegments, setDraftSegments] = useState<Candidate["segments"]>([]);
  const [draftCandidateId, setDraftCandidateId] = useState<string | null>(null);
  const [segmentUndoStack, setSegmentUndoStack] = useState<Candidate["segments"][]>([]);
  const [note, setNote] = useState("");
  const [directoryConnected, setDirectoryConnected] = useState(false);
  const [draftRevision, setDraftRevision] = useState(0);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [currentVideoTimeMs, setCurrentVideoTimeMs] = useState(0);
  const [rangeDrag, setRangeDrag] = useState<ReviewRangeDrag | null>(null);
  const [selectedSegmentRepIndex, setSelectedSegmentRepIndex] = useState<number | null>(null);
  const [inboxItems, setInboxItems] = useState<readonly AnnotationInboxItem[]>([]);
  const [inboxWork, setInboxWork] = useState<{ itemId: string; phase: "tracking" | "archiving"; progress: number } | null>(null);

  const selected = captures.find((capture) => capture.id === selectedId) ?? null;
  const selectedDurationMs = selected
    ? Math.max(
        1,
        Math.round(selected.fixture.durationSec * 1000),
        selected.fixture.poses.at(-1)?.timestampMs ?? 0,
      )
    : 1;
  const quality = selected ? qualityOf(selected.fixture.poses) : null;
  const candidates = useMemo(
    () => selected ? candidatesFor(selected, exerciseId, cameraView) : [],
    [selected, exerciseId, cameraView],
  );
  const replayReport = useMemo(() => replayReportFor(captures), [captures]);
  const highPriorityCount = replayReport.filter((row) => row.priority === "high").length;
  const consistentCount = replayReport.filter((row) => row.priority === "low").length;
  // A trajectory is materialized while the athlete approves it. We never
  // rebuild an accepted record from a different import later, because that
  // would make the same approval mean different data.
  const trajectoryDecisions = useMemo(
    () => Object.values(approvals).flatMap((approval) =>
      approval.exerciseId === "lat_pulldown" && approval.trajectoryDataset
        ? [approval.trajectoryDataset]
        : []),
    [approvals],
  );
  const eligibleTrajectorySamples = trajectoryDecisions.flatMap((decision) =>
    decision.decision === "eligible" && decision.sample ? [decision.sample] : [],
  );
  const selectedTrajectoryDecision = selected
    ? approvals[selected.id]?.trajectoryDataset ?? null
    : null;

  // Every edit is durable before the user can move to another capture. This is
  // intentionally local-only and distinct from an approved ground-truth label.
  useLayoutEffect(() => {
    if (!selectedId) return;
    const next: Record<string, ReviewDraft> = {
      ...draftsRef.current,
      [selectedId]: {
        exerciseId,
        cameraView,
        capturePosition,
        expectedCount,
        draftCandidateId,
        draftSegments,
        segmentUndoStack,
        note,
        updatedAt: new Date().toISOString(),
      },
    };
    draftsRef.current = next;
    saveDrafts(next);
    setDraftRevision((revision) => revision + 1);
  }, [cameraView, capturePosition, draftCandidateId, draftSegments, exerciseId, expectedCount, note, segmentUndoStack, selectedId]);

  const hasExportableLocalData = Object.keys(approvals).length > 0 || Object.keys(draftsRef.current).length > 0 || draftRevision > 0;

  useEffect(() => () => captures.forEach((capture) => {
    if (capture.revokeVideoUrl) URL.revokeObjectURL(capture.videoUrl);
  }), [captures]);

  const installCaptures = (loaded: ReviewCapture[]) => {
    if (!loaded.length) return false;
    const unchanged =
      capturesRef.current.length === loaded.length &&
      capturesRef.current.every((capture, index) =>
        capture.id === loaded[index]?.id &&
        capture.sourceSignature === loaded[index]?.sourceSignature &&
        capture.fixture.poses.length === loaded[index]?.fixture.poses.length,
      );
    if (unchanged) {
      loaded.forEach((capture) => {
        if (capture.revokeVideoUrl) URL.revokeObjectURL(capture.videoUrl);
      });
      return true;
    }
    capturesRef.current.forEach((capture) => {
      if (capture.revokeVideoUrl) URL.revokeObjectURL(capture.videoUrl);
    });
    capturesRef.current = loaded;
    setCaptures(loaded);
    const retained = loaded.find((capture) => capture.id === selectedIdRef.current);
    // Start an unattended review session with the riskiest evidence, not simply
    // the newest recording. The same priority order is visible in the report.
    const next = retained ?? replayReportFor(loaded)[0]?.capture ?? loaded[0];
    if (!retained) {
      selectedIdRef.current = next.id;
      setSelectedId(next.id);
      const storedApproval = approvalsRef.current[next.id];
      const savedDraft = draftsRef.current[next.id];
      setExerciseId(storedApproval?.exerciseId ?? savedDraft?.exerciseId ?? next.labels?.exerciseId ?? "");
      const nextPosition = importedCapturePosition(storedApproval?.capturePosition ?? savedDraft?.capturePosition ?? next.labels?.capturePosition);
      setCapturePosition(nextPosition);
      setCameraView(analysisViewFor(nextPosition) ?? storedApproval?.cameraView ?? savedDraft?.cameraView ?? next.labels?.cameraView ?? "oblique45");
      setExpectedCount(storedApproval?.expectedCount ?? savedDraft?.expectedCount ?? "");
      setDraftSegments(storedApproval?.approvedSegments ?? savedDraft?.draftSegments ?? []);
      setDraftCandidateId(storedApproval?.candidateId ?? savedDraft?.draftCandidateId ?? null);
      setSegmentUndoStack(storedApproval ? [] : savedDraft?.segmentUndoStack ?? []);
      setNote(storedApproval?.note ?? savedDraft?.note ?? "");
      setCurrentVideoTimeMs(0);
      rangeDragRef.current = null;
      setRangeDrag(null);
      setSelectedSegmentRepIndex(null);
      segmentEditRef.current = null;
    }
    return true;
  };

  const mergeCaptureSource = (
    loaded: ReviewCapture[],
    replacedSource: ReviewCapture["sourceKind"],
  ) => {
    const loadedIds = new Set(loaded.map((capture) => capture.id));
    installCaptures([
      ...loaded,
      ...capturesRef.current.filter((capture) =>
        capture.sourceKind !== replacedSource && !loadedIds.has(capture.id),
      ),
    ]);
    return loaded.length > 0;
  };

  const importFiles = async (files: File[]) => {
    setError(null);
    const loaded = await parseCaptureFiles(files, "manual");
    if (!mergeCaptureSource(loaded, "manual")) {
      setError("没有找到完整采集包：每组需要同名的 .webm/.mp4/.mov 与 .json 文件。");
    }
  };

  const processInboxItem = async (item: AnnotationInboxItem) => {
    const existing = capturesRef.current.find((capture) => capture.inboxItem?.id === item.id);
    if (existing) {
      chooseCapture(existing);
      return;
    }
    if (processingInboxIdsRef.current.has(item.id)) return;
    processingInboxIdsRef.current.add(item.id);
    setError(null);
    setExportNotice(null);
    setInboxWork({ itemId: item.id, phase: "tracking", progress: 0 });
    try {
      const fixture = await extractInboxVideoPoseFixture({
        item,
        videoUrl: annotationInboxVideoUrl(item),
        onProgress: (progress) => setInboxWork({ itemId: item.id, phase: "tracking", progress }),
      });
      const capture: ReviewCapture = {
        id: item.id,
        videoUrl: annotationInboxVideoUrl(item),
        sourceSignature: `annotation-inbox:${item.filename}:${item.sizeBytes}`,
        revokeVideoUrl: false,
        fixture,
        labels: null,
        metadata: null,
        sourceKind: "inbox",
        inboxItem: item,
      };
      installCaptures([
        capture,
        ...capturesRef.current.filter((current) => current.id !== capture.id),
      ]);
      chooseCapture(capture);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      processingInboxIdsRef.current.delete(item.id);
      setInboxWork(null);
    }
  };

  const refreshConnectedDirectory = async (directory?: DirectoryHandle) => {
    try {
      const saved = directory ?? await restoreDirectory();
      if (!saved) return;
      const permission = saved.queryPermission ? await saved.queryPermission({ mode: "read" }) : "granted";
      if (permission !== "granted") {
        setDirectoryConnected(false);
        return;
      }
      const loaded = await parseCaptureFiles(await filesFromDirectory(saved), "directory");
      if (mergeCaptureSource(loaded, "directory")) setDirectoryConnected(true);
    } catch {
      // A browser can revoke a persisted handle. The manual import control
      // remains available and is the recovery path.
      setDirectoryConnected(false);
    }
  };

  useEffect(() => {
    if (!inboxInitializedRef.current) {
      inboxInitializedRef.current = true;
      void Promise.allSettled([loadAnnotationInbox(), loadProjectCaptures()])
        .then(async ([inboxResult, projectResult]) => {
          if (projectResult.status === "fulfilled") {
            mergeCaptureSource(projectResult.value, "project");
          }
          if (inboxResult.status === "rejected") {
            setInboxWarning(inboxResult.reason instanceof Error ? inboxResult.reason.message : String(inboxResult.reason));
          } else {
            inboxItemsRef.current = inboxResult.value.items;
            setInboxItems(inboxResult.value.items);
            if (inboxResult.value.items[0]) await processInboxItem(inboxResult.value.items[0]);
          }
          if (projectResult.status === "rejected" && inboxResult.status === "rejected") {
            setError(projectResult.reason instanceof Error ? projectResult.reason.message : String(projectResult.reason));
          }
        });
    }
    void refreshConnectedDirectory();
    const timer = window.setInterval(() => void refreshConnectedDirectory(), 10_000);
    return () => window.clearInterval(timer);
  // Only establish the background directory watcher once; user selections
  // remain local state and must not restart it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const importDirectory = async () => {
    const picker = (window as unknown as { showDirectoryPicker?: () => Promise<DirectoryHandle> }).showDirectoryPicker;
    if (!picker) {
      fileInputRef.current?.click();
      return;
    }
    try {
      const directory = await picker();
      await persistDirectory(directory);
      await refreshConnectedDirectory(directory);
    } catch (caught) {
      if ((caught as DOMException)?.name !== "AbortError") {
        setError(caught instanceof Error ? caught.message : String(caught));
      }
    }
  };

  const chooseCapture = (capture: ReviewCapture) => {
    const storedApproval = approvalsRef.current[capture.id];
    const savedDraft = draftsRef.current[capture.id];
    selectedIdRef.current = capture.id;
    setSelectedId(capture.id);
    setExerciseId(storedApproval?.exerciseId ?? savedDraft?.exerciseId ?? capture.labels?.exerciseId ?? "");
    const nextPosition = importedCapturePosition(storedApproval?.capturePosition ?? savedDraft?.capturePosition ?? capture.labels?.capturePosition);
    setCapturePosition(nextPosition);
    setCameraView(analysisViewFor(nextPosition) ?? storedApproval?.cameraView ?? savedDraft?.cameraView ?? capture.labels?.cameraView ?? "oblique45");
    setExpectedCount(storedApproval?.expectedCount ?? savedDraft?.expectedCount ?? "");
    setDraftSegments(storedApproval?.approvedSegments ?? savedDraft?.draftSegments ?? []);
    setDraftCandidateId(storedApproval?.candidateId ?? savedDraft?.draftCandidateId ?? null);
    setSegmentUndoStack(storedApproval ? [] : savedDraft?.segmentUndoStack ?? []);
    setNote(storedApproval?.note ?? savedDraft?.note ?? "");
    setCurrentVideoTimeMs(0);
    rangeDragRef.current = null;
    setRangeDrag(null);
    setSelectedSegmentRepIndex(null);
    segmentEditRef.current = null;
  };

  const chooseAdjacentCapture = (direction: -1 | 1) => {
    if (!captures.length) return;
    const currentIndex = Math.max(0, captures.findIndex((capture) => capture.id === selected?.id));
    const nextIndex = Math.min(captures.length - 1, Math.max(0, currentIndex + direction));
    chooseCapture(captures[nextIndex]);
  };

  const selectDraftSegments = (candidate: Candidate) => {
    setError(null);
    setSegmentUndoStack((current) => [...current.slice(-19), draftSegments.map((segment) => ({ ...segment }))]);
    setDraftCandidateId(candidate.id);
    setDraftSegments(candidate.segments.map((segment) => ({ ...segment })));
    setSelectedSegmentRepIndex(null);
  };

  const updateDraftSegment = (
    repIndex: number,
    field: "startMs" | "peakMs" | "endMs",
    value: number,
  ) => {
    setDraftSegments((current) => current.map((segment) =>
      segment.repIndex === repIndex ? { ...segment, [field]: value } : segment,
    ));
  };

  const updateDraftSegmentNote = (repIndex: number, segmentNote: string) => {
    setDraftSegments((current) => current.map((segment) =>
      segment.repIndex === repIndex ? { ...segment, note: segmentNote } : segment,
    ));
  };

  const addDraftSegment = () => {
    const last = draftSegments.at(-1);
    const startMs = last ? last.endMs + 1 : selected?.fixture.poses[0]?.timestampMs ?? 0;
    setSegmentUndoStack((current) => [...current.slice(-19), draftSegments.map((segment) => ({ ...segment }))]);
    setDraftSegments((current) => [...current, {
      repIndex: (last?.repIndex ?? 0) + 1,
      startMs,
      peakMs: startMs + 250,
      endMs: startMs + 500,
    }]);
    setDraftCandidateId("manual_range");
    setSelectedSegmentRepIndex((last?.repIndex ?? 0) + 1);
  };

  const clearTimelineSegments = () => {
    if (!draftSegments.length) return;
    setSegmentUndoStack((current) => [...current.slice(-19), draftSegments.map((segment) => ({ ...segment }))]);
    setDraftSegments([]);
    setDraftCandidateId(null);
    setSelectedSegmentRepIndex(null);
    setError(null);
  };

  const undoTimelineSegments = () => {
    const previous = segmentUndoStack.at(-1);
    if (!previous) return;
    setSegmentUndoStack((current) => current.slice(0, -1));
    setDraftSegments(restoreReviewRangeSnapshot(previous, draftSegments));
    setDraftCandidateId(previous.length ? "manual_range" : null);
    setSelectedSegmentRepIndex(null);
    setError(null);
  };

  const removeDraftSegment = (repIndex: number) => {
    setSegmentUndoStack((current) => [...current.slice(-19), draftSegments.map((segment) => ({ ...segment }))]);
    setDraftSegments((current) => current
      .filter((item) => item.repIndex !== repIndex)
      .map((item, index) => ({ ...item, repIndex: index + 1 })));
    setSelectedSegmentRepIndex(null);
  };

  const seekReviewVideo = (timestampMs: number) => {
    const nextMs = Math.min(selectedDurationMs, Math.max(0, timestampMs));
    if (reviewVideoRef.current) reviewVideoRef.current.currentTime = nextMs / 1000;
    setCurrentVideoTimeMs(nextMs);
  };

  const timelineMsForPointer = (clientX: number, element: HTMLDivElement) => {
    const bounds = element.getBoundingClientRect();
    return timelineTimeAt(clientX, bounds.left, bounds.width, selectedDurationMs);
  };

  const finishRangeDrag = (drag: ReviewRangeDrag, focusMs: number) => {
    const result = addReviewRange({
      existing: draftSegments,
      candidateSegments: candidates.flatMap((candidate) => candidate.segments),
      anchorMs: drag.anchorMs,
      focusMs,
      durationMs: selectedDurationMs,
    });
    rangeDragRef.current = null;
    setRangeDrag(null);
    seekReviewVideo(focusMs);
    if (result.status === "added") {
      setSegmentUndoStack((current) => [...current.slice(-19), draftSegments.map((segment) => ({ ...segment }))]);
      setDraftCandidateId("manual_range");
      setDraftSegments(result.segments);
      setSelectedSegmentRepIndex(result.added.repIndex);
      setError(null);
    } else if (result.status === "rejected") {
      setError(result.reason);
    }
  };

  const beginSegmentEdit = (
    event: React.PointerEvent<HTMLElement>,
    segment: Candidate["segments"][number],
    mode: ReviewRangeEditMode,
  ) => {
    event.stopPropagation();
    const track = timelineTrackRef.current;
    const captureElement = (event.currentTarget as HTMLElement).closest("[data-timeline-rep]") as HTMLElement | null;
    if (!track || !captureElement) return;
    captureElement.setPointerCapture(event.pointerId);
    const bounds = track.getBoundingClientRect();
    setSelectedSegmentRepIndex(segment.repIndex);
    const edit: ReviewSegmentEdit = {
      pointerId: event.pointerId,
      repIndex: segment.repIndex,
      mode,
      pointerOriginMs: timelineTimeAt(event.clientX, bounds.left, bounds.width, selectedDurationMs),
      original: { ...segment },
      historyCaptured: false,
    };
    segmentEditRef.current = edit;
  };

  const continueSegmentEdit = (event: React.PointerEvent<HTMLElement>) => {
    const edit = segmentEditRef.current;
    if (!edit || edit.pointerId !== event.pointerId || !timelineTrackRef.current) return;
    event.stopPropagation();
    const bounds = timelineTrackRef.current.getBoundingClientRect();
    const pointerMs = timelineTimeAt(event.clientX, bounds.left, bounds.width, selectedDurationMs);
    const ordered = [...draftSegments].sort((left, right) => left.startMs - right.startMs);
    const segmentIndex = ordered.findIndex((segment) => segment.repIndex === edit.repIndex);
    if (segmentIndex < 0) return;
    const updated = editReviewRange({
      segment: edit.original,
      mode: edit.mode,
      pointerMs,
      pointerOriginMs: edit.pointerOriginMs,
      previousEndMs: ordered[segmentIndex - 1]?.endMs ?? 0,
      nextStartMs: ordered[segmentIndex + 1]?.startMs ?? selectedDurationMs,
    });
    const changed = updated.startMs !== edit.original.startMs || updated.endMs !== edit.original.endMs;
    if (!changed) return;
    if (!edit.historyCaptured) {
      setSegmentUndoStack((current) => [...current.slice(-19), draftSegments.map((segment) => ({ ...segment }))]);
      segmentEditRef.current = { ...edit, historyCaptured: true };
    }
    setDraftSegments((current) => current.map((segment) =>
      segment.repIndex === updated.repIndex ? updated : segment,
    ));
    seekReviewVideo(edit.mode === "resize-end" ? updated.endMs : updated.startMs);
  };

  const approve = async () => {
    if (!selected) return;
    if (!draftCandidateId) {
      setError("先选择一个候选分段，并逐 rep 检查或修正 start / peak / end 边界。");
      return;
    }
    const validationError = approvalValidationError({
      exerciseId,
      capturePosition,
      expectedCount,
      segments: draftSegments,
      poses: selected.fixture.poses,
    });
    if (validationError) {
      setError(validationError);
      return;
    }
    const approvedAt = new Date().toISOString();
    const confirmedPosition = capturePosition || null;
    // The physical placement is the source of truth. The smaller CameraView
    // vocabulary is derived from it rather than being independently editable.
    const approvedCameraView = analysisViewFor(capturePosition) ?? cameraView;
    const trajectoryBuild = exerciseId === "lat_pulldown"
      ? buildApprovedLatPulldownTrajectorySample({
          captureId: selected.id,
          exerciseId,
          cameraView: approvedCameraView,
          capturePosition: confirmedPosition,
          approvedAt,
          expectedCount,
          approvedSegments: draftSegments,
          poses: selected.fixture.poses,
          model: selected.fixture.model ?? selected.labels?.model ?? null,
        })
      : null;
    const trajectoryDataset: TrajectoryDatasetDecision | null = trajectoryBuild
      ? trajectoryBuild.status === "ready"
        ? {
            decision: trajectoryBuild.sample.quality.eligibleForSegmentationTraining ? "eligible" : "quarantined",
            reason: trajectoryBuild.sample.quality.reason,
            sample: trajectoryBuild.sample,
            recordedAt: approvedAt,
          }
        : { decision: "quarantined", reason: trajectoryBuild.reason, sample: null, recordedAt: approvedAt }
      : null;
    const previous = approvals[selected.id];
    const analysisVersions: readonly ReviewAnalysisVersion[] = [
      ...(previous?.analysisVersions ?? (previous ? [{
        version: 1,
        approvedAt: previous.approvedAt,
        sourceSignature: selected.sourceSignature,
        canonicalPoseFrameCount: selected.fixture.poses.length,
        expectedCount: previous.expectedCount,
        candidateId: previous.candidateId,
        approvedSegments: previous.approvedSegments,
        weakNegativeWindows: reviewedNegativeWindows(selectedDurationMs, previous.approvedSegments),
        recognitionSnapshot: {
          motionVersions: selected.metadata?.motionVersions ?? null,
          referenceStatus: selected.metadata?.referenceComparison?.status ?? null,
          needsReviewCandidateCount: selected.metadata?.rustNeedsReviewReps?.length ?? 0,
          rejectedCandidateCount: selected.metadata?.rustRejectedReps?.length ?? 0,
        },
        note: previous.note,
        algorithmVersion: "reviewed-canonical-replay/v1" as const,
      }] : [])),
      {
        version: (previous?.analysisVersions?.length ?? (previous ? 1 : 0)) + 1,
        approvedAt,
        sourceSignature: selected.sourceSignature,
        canonicalPoseFrameCount: selected.fixture.poses.length,
        expectedCount,
        candidateId: draftCandidateId,
        approvedSegments: draftSegments.map((segment) => ({ ...segment })),
        weakNegativeWindows: reviewedNegativeWindows(selectedDurationMs, draftSegments),
        recognitionSnapshot: {
          motionVersions: selected.metadata?.motionVersions ?? null,
          referenceStatus: selected.metadata?.referenceComparison?.status ?? null,
          needsReviewCandidateCount: selected.metadata?.rustNeedsReviewReps?.length ?? 0,
          rejectedCandidateCount: selected.metadata?.rustRejectedReps?.length ?? 0,
        },
        note: note.trim(),
        algorithmVersion: "reviewed-canonical-replay/v1",
      },
    ];
    const approvedRecord: Approval = {
      expectedCount,
      candidateId: draftCandidateId,
      candidateCount: draftSegments.length,
      exerciseId,
      cameraView: approvedCameraView,
      variation: selected.labels?.variation ?? null,
      trainingSide: selected.labels?.trainingSide ?? null,
      profileVersion: selected.labels?.profileVersion ?? null,
      model: selected.fixture.model ?? selected.labels?.model ?? "unknown",
      approvedSegments: draftSegments,
      approvedAt,
      note: note.trim(),
      capturePosition: confirmedPosition,
      trajectoryDataset,
      analysisVersions,
    };
    if (selected.inboxItem) {
      setInboxWork({ itemId: selected.inboxItem.id, phase: "archiving", progress: 1 });
      try {
        await completeReviewedInboxItem({
          item: selected.inboxItem,
          fixture: {
            ...selected.fixture,
            stepMs: selected.fixture.stepMs ?? (
              selected.fixture.poses.length > 1
                ? selected.fixture.durationSec * 1000 / (selected.fixture.poses.length - 1)
                : 0
            ),
            model: selected.fixture.model ?? "unknown",
          },
          approval: {
            exerciseId: approvedRecord.exerciseId,
            cameraView: approvedRecord.cameraView,
            capturePosition: confirmedPosition!,
            expectedCount: approvedRecord.expectedCount,
            approvedAt: approvedRecord.approvedAt,
            approvedSegments: approvedRecord.approvedSegments,
            candidateId: approvedRecord.candidateId,
            note: approvedRecord.note,
          },
        });
      } catch (caught) {
        setInboxWork(null);
        setError(caught instanceof Error ? caught.message : String(caught));
        return;
      }
    }
    const next: Record<string, Approval> = { ...approvals, [selected.id]: approvedRecord };
    approvalsRef.current = next;
    setApprovals(next);
    try {
      localStorage.setItem(APPROVAL_KEY, JSON.stringify(next));
    } catch {
      setError("审批已归档，但浏览器未允许写入本机审批缓存。");
    }
    if (!selected.inboxItem) {
      // Imported capture packages retain the legacy portable-download fallback.
      downloadJson(
        { version: "capture-approval/v3", approvals: next },
        `field-capture-approval-${selected.id}.json`,
      );
    }
    if (trajectoryDataset?.decision === "eligible" && trajectoryDataset.sample) {
      downloadJson({
        schemaVersion: "form-coach-trajectory-dataset/v1",
        exerciseId: "lat_pulldown",
        intendedUse: "rep_segmentation_observation",
        formReference: "not_labeled",
        generatedAt: approvedAt,
        samples: [trajectoryDataset.sample],
        quarantined: [],
      }, `lat-pulldown-segmentation-trajectory-${selected.id}.json`);
    }
    if (selected.inboxItem) {
      const completedId = selected.inboxItem.id;
      const remaining = inboxItems.filter((item) => item.id !== completedId);
      inboxItemsRef.current = remaining;
      setInboxItems(remaining);
      const remainingCaptures = capturesRef.current.filter((capture) => capture.id !== selected.id);
      capturesRef.current = remainingCaptures;
      setCaptures(remainingCaptures);
      selectedIdRef.current = null;
      setSelectedId(null);
      const drafts = { ...draftsRef.current };
      delete drafts[selected.id];
      draftsRef.current = drafts;
      saveDrafts(drafts);
      setInboxWork(null);
      setExportNotice(`✓ ${selected.inboxItem.filename} 已归档并从 new-video 移出。`);
      if (remaining[0]) void processInboxItem(remaining[0]);
      else if (remainingCaptures[0]) chooseCapture(remainingCaptures[0]);
    }
  };

  const exportApprovals = () => {
    // Read at click time: exports must survive a page remount and must include
    // the unapproved local drafts the athlete is actively editing.
    downloadJson({
      version: "capture-approval/v3",
      exportedAt: new Date().toISOString(),
      approvals: loadApprovals(),
      drafts: loadDrafts(),
    }, `field-capture-approvals-${new Date().toISOString().slice(0, 10)}.json`);
    setExportNotice("已从本机 localStorage 导出审批与草稿 JSON。请在浏览器下载列表查看。");
  };

  const exportLatPulldownTrajectoryDataset = () => {
    const storedDecisions = Object.values(loadApprovals()).flatMap((approval) =>
      approval.exerciseId === "lat_pulldown" && approval.trajectoryDataset
        ? [approval.trajectoryDataset]
        : [],
    );
    const storedEligibleSamples = storedDecisions.flatMap((decision) =>
      decision.decision === "eligible" && decision.sample ? [decision.sample] : [],
    );
    if (!storedEligibleSamples.length) {
      setError("还没有可训练的高位下拉样本：需审批动作、填写实际次数，并让批准边界与次数一致。");
      return;
    }
    downloadJson({
      schemaVersion: "form-coach-trajectory-dataset/v1",
      exerciseId: "lat_pulldown",
      intendedUse: "rep_segmentation_observation",
      formReference: "not_labeled",
      generatedAt: new Date().toISOString(),
      samples: storedEligibleSamples,
      quarantined: storedDecisions
        .filter((decision) => decision.decision === "quarantined")
        .map(({ reason, recordedAt, sample }) => ({ reason, recordedAt, sampleId: sample?.sampleId ?? null })),
    }, `lat-pulldown-trajectory-dataset-${new Date().toISOString().slice(0, 10)}.json`);
    setExportNotice("已从本机 localStorage 导出高位下拉分段轨迹 JSON。请在浏览器下载列表查看。");
  };

  return (
    <section style={styles.shell}>
      <header style={styles.header}>
        <div>
          <div style={styles.kicker}>FIELD EVIDENCE / 本机审核</div>
          <h2 style={styles.title}>{compact ? "逐组视频审核标注" : "训练录像审批台"}</h2>
          <p style={styles.subtitle}>{directoryConnected ? "Downloads 已连接 · 每 10 秒自动加载新的导出包" : "同一关键点序列的固定回放对比；审批结果只保存在这台设备。"} 审批只标注动作、次数与边界，不把你的训练动作当成标准姿势。</p>
        </div>
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
          <button style={styles.importButton} onClick={() => void importDirectory()}>导入 Downloads 采集包</button>
          <button style={styles.manualImport} onClick={() => fileInputRef.current?.click()}>手动选择文件</button>
          <button style={styles.manualImport} disabled={!hasExportableLocalData} onClick={exportApprovals}>导出审批真值</button>
          <button style={styles.manualImport} disabled={!eligibleTrajectorySamples.length} onClick={exportLatPulldownTrajectoryDataset}>导出高位下拉分段轨迹数据</button>
        </div>
        <input
          data-testid="capture-review-files"
          ref={fileInputRef}
          type="file"
          multiple
          accept=".json,.webm,.mp4,.mov"
          style={{ display: "none" }}
          onChange={(event) => {
            void importFiles(Array.from(event.currentTarget.files ?? []));
            event.currentTarget.value = "";
          }}
        />
      </header>
      {inboxItems.length > 0 && (
        <div style={styles.inboxBar}>
          <div>
            <strong>NEW-VIDEO / 待标注收件箱</strong>
            <span>{inboxItems.length} 个视频；选择后先生成 canonical 骨架，批准后自动迁入正式档案。</span>
          </div>
          <select
            aria-label="待标注视频"
            value={inboxWork?.itemId ?? selected?.inboxItem?.id ?? ""}
            disabled={inboxWork !== null}
            onChange={(event) => {
              const item = inboxItems.find((candidate) => candidate.id === event.target.value);
              if (item) void processInboxItem(item);
            }}
          >
            <option value="">选择待标注视频…</option>
            {inboxItems.map((item) => <option key={item.id} value={item.id}>{item.filename}</option>)}
          </select>
          {inboxWork?.phase === "tracking" && (
            <span style={styles.inboxProgress}>正在识别骨架 {Math.round(inboxWork.progress * 100)}%</span>
          )}
          {inboxWork?.phase === "archiving" && <span style={styles.inboxProgress}>正在归档并迁移…</span>}
        </div>
      )}
      {inboxWarning && <p style={styles.inboxWarning}>待标注收件箱未加载：{inboxWarning}</p>}
      {error && <p style={styles.error}>{error}</p>}
      {exportNotice && <p style={styles.exportNotice}>{exportNotice}</p>}
      {!compact && !!replayReport.length && (
        <section style={styles.replayShell} aria-label="算法重放报告">
          <div style={styles.replayIntro}>
            <div>
              <div style={styles.kicker}>ALGORITHM REPLAY / 当前骨架回放</div>
              <h3 style={styles.replayTitle}>本机算法重放报告</h3>
              <p style={styles.replayCopy}>同一份 canonical 骨架数据，同时驱动这里的候选计数、视频标记与最终审批。</p>
            </div>
            <div style={styles.metrics}>
              <span><b>{replayReport.length}</b> 组已重放</span>
              <span style={{ color: highPriorityCount ? "#ffbd6f" : "#7cffbc" }}><b>{highPriorityCount}</b> 组优先审核</span>
              <span><b>{consistentCount}</b> 组候选一致</span>
              <span style={{ color: eligibleTrajectorySamples.length ? "#7cffbc" : "#89aaa1" }}><b>{eligibleTrajectorySamples.length}</b> 组高位下拉分段观察</span>
            </div>
          </div>
          <div style={styles.replayRows}>
            {replayReport.map((row) => (
              <button key={row.capture.id} onClick={() => chooseCapture(row.capture)} style={{ ...styles.replayRow, ...(row.capture.id === selected?.id ? styles.replayRowActive : {}) }}>
                <span style={{ ...styles.priority, ...(row.priority === "high" ? styles.priorityHigh : row.priority === "normal" ? styles.priorityNormal : styles.priorityLow) }}>{row.priority === "high" ? "优先" : row.priority === "normal" ? "复核" : "一致"}</span>
                <span style={styles.replayStamp}>{row.capture.id.replace("field-capture-2026-08-02T", "").replace("Z", "")}</span>
                <span style={styles.replayAction}>{row.capture.labels?.exerciseId ?? "未标动作"}</span>
                <span style={styles.replayNumbers}>历史 {row.historicalCount ?? "—"} · 全帧 {row.currentCount ?? "—"} · 稳定段 {row.stableCount ?? "—"} · 周期 {row.automaticCount}</span>
                <span style={styles.replayQuality}>POSE {row.quality.posePercent}% / 躯干 {row.quality.torsoPercent}%</span>
                <span style={styles.replayReason}>{row.reason}</span>
              </button>
            ))}
          </div>
        </section>
      )}
      {!captures.length ? (
        <p style={styles.empty}>{inboxWork ? "正在从待标注视频生成 canonical 骨架…" : "待标注目录为空；也可以选择 Downloads 文件夹导入成套采集文件。"}</p>
      ) : (
        <div style={compact ? styles.compactGrid : styles.grid}>
          {!compact && <nav style={styles.ledger} aria-label="采集组列表">
            {captures.map((capture) => {
              const report = qualityOf(capture.fixture.poses);
              const approved = approvals[capture.id];
              return (
                <button key={capture.id} onClick={() => chooseCapture(capture)} style={{ ...styles.capture, ...(capture.id === selected?.id ? styles.captureActive : {}) }}>
                  <strong>{capture.id.replace("field-capture-", "")}</strong>
                  <span>{capture.labels?.exerciseId ?? "未标动作"} · {capture.fixture.durationSec.toFixed(1)}s</span>
                  <span style={{ color: report.posePercent >= 90 ? "#7cffbc" : "#ffbd6f" }}>骨架 {report.posePercent}%</span>
                  {approved && <em>已审批 · {approved.expectedCount || "未填次数"} 次</em>}
                </button>
              );
            })}
          </nav>}
          {selected && quality && (
            <div style={styles.detail}>
              <div style={styles.videoColumn}>
                <video
                  data-capture-review-video
                  ref={reviewVideoRef}
                  key={selected.id}
                  src={selected.videoUrl}
                  controls
                  preload="metadata"
                  style={styles.video}
                  onTimeUpdate={(event) => setCurrentVideoTimeMs(event.currentTarget.currentTime * 1000)}
                />
                <div style={styles.timelineShell}>
                  <div style={styles.timelineHeader}>
                    <div>
                      <strong>REP RANGE / 拖选一次动作范围</strong>
                      <span>空白处拖选新增；拖动色块移动；选中后拖两侧缩放</span>
                    </div>
                    <div style={styles.timelineHeaderActions}>
                      <div style={styles.timelineCounter}><b>{draftSegments.length}</b> / {expectedCount || "?"} REPS</div>
                      <button type="button" disabled={!segmentUndoStack.length} onClick={undoTimelineSegments}>↶ 撤回</button>
                      <button type="button" disabled={!draftSegments.length} onClick={clearTimelineSegments}>清空</button>
                    </div>
                  </div>
                  <div
                    data-review-range-timeline
                    ref={timelineTrackRef}
                    role="slider"
                    tabIndex={0}
                    aria-label="rep 范围标注时间轴"
                    aria-valuemin={0}
                    aria-valuemax={selectedDurationMs}
                    aria-valuenow={Math.round(currentVideoTimeMs)}
                    style={styles.timelineTrack}
                    onPointerDown={(event) => {
                      event.currentTarget.setPointerCapture(event.pointerId);
                      const timestampMs = timelineMsForPointer(event.clientX, event.currentTarget);
                      const drag = { pointerId: event.pointerId, anchorMs: timestampMs, focusMs: timestampMs };
                      rangeDragRef.current = drag;
                      setRangeDrag(drag);
                      seekReviewVideo(timestampMs);
                    }}
                    onPointerMove={(event) => {
                      const drag = rangeDragRef.current;
                      if (!drag || drag.pointerId !== event.pointerId) return;
                      const focusMs = timelineMsForPointer(event.clientX, event.currentTarget);
                      const nextDrag = { ...drag, focusMs };
                      rangeDragRef.current = nextDrag;
                      setRangeDrag(nextDrag);
                      seekReviewVideo(focusMs);
                    }}
                    onPointerUp={(event) => {
                      const drag = rangeDragRef.current;
                      if (!drag || drag.pointerId !== event.pointerId) return;
                      finishRangeDrag(drag, timelineMsForPointer(event.clientX, event.currentTarget));
                    }}
                    onPointerCancel={() => { rangeDragRef.current = null; setRangeDrag(null); }}
                    onKeyDown={(event) => {
                      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                      event.preventDefault();
                      seekReviewVideo(currentVideoTimeMs + (event.key === "ArrowLeft" ? -250 : 250));
                    }}
                  >
                    {[0, 25, 50, 75, 100].map((tick) => <i key={tick} style={{ ...styles.timelineTick, left: `${tick}%` }} />)}
                    {draftSegments.map((segment) => {
                      const left = (segment.startMs / selectedDurationMs) * 100;
                      const width = Math.max(.45, ((segment.endMs - segment.startMs) / selectedDurationMs) * 100);
                      const peak = ((segment.peakMs - segment.startMs) / Math.max(1, segment.endMs - segment.startMs)) * 100;
                      return (
                        <div
                          key={segment.repIndex}
                          data-timeline-rep
                          role="button"
                          tabIndex={0}
                          title={`#${segment.repIndex} ${formatTimelineTime(segment.startMs)}–${formatTimelineTime(segment.endMs)}`}
                          style={{
                            ...styles.timelineRep,
                            ...(selectedSegmentRepIndex === segment.repIndex ? styles.timelineRepSelected : null),
                            left: `${left}%`,
                            width: `${width}%`,
                          }}
                          onPointerDown={(event) => beginSegmentEdit(event, segment, "move")}
                          onPointerMove={continueSegmentEdit}
                          onPointerUp={(event) => { event.stopPropagation(); segmentEditRef.current = null; }}
                          onPointerCancel={() => { segmentEditRef.current = null; }}
                          onClick={() => seekReviewVideo(segment.startMs)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") seekReviewVideo(segment.startMs);
                          }}
                        >
                          {selectedSegmentRepIndex === segment.repIndex && (
                            <span
                              aria-label="调整 rep 开始"
                              style={{ ...styles.timelineHandle, left: 0 }}
                              onPointerDown={(event) => beginSegmentEdit(event, segment, "resize-start")}
                            />
                          )}
                          <span>#{segment.repIndex}</span>
                          <i style={{ ...styles.timelinePeak, left: `${peak}%` }} />
                          {selectedSegmentRepIndex === segment.repIndex && (
                            <span
                              aria-label="调整 rep 结束"
                              style={{ ...styles.timelineHandle, right: 0 }}
                              onPointerDown={(event) => beginSegmentEdit(event, segment, "resize-end")}
                            />
                          )}
                        </div>
                      );
                    })}
                    {rangeDrag && (
                      <div style={{
                        ...styles.timelineSelection,
                        left: `${(Math.min(rangeDrag.anchorMs, rangeDrag.focusMs) / selectedDurationMs) * 100}%`,
                        width: `${(Math.abs(rangeDrag.focusMs - rangeDrag.anchorMs) / selectedDurationMs) * 100}%`,
                      }} />
                    )}
                    <i style={{ ...styles.timelinePlayhead, left: `${(currentVideoTimeMs / selectedDurationMs) * 100}%` }} />
                  </div>
                  <div style={styles.timelineFooter}>
                    <span>0:00.0</span>
                    <span>当前 {formatTimelineTime(currentVideoTimeMs)}</span>
                    <span>{formatTimelineTime(selectedDurationMs)}</span>
                  </div>
                </div>
                <div style={styles.qualityStrip}>
                  <span>POSE {quality.posePercent}%</span><span>躯干完整 {quality.torsoPercent}%</span><span>{quality.frames} 帧</span>
                </div>
                {compact && (
                  <div style={styles.reviewNavigation}>
                    <button disabled={captures.findIndex((capture) => capture.id === selected.id) <= 0} onClick={() => chooseAdjacentCapture(-1)}>← 上一组</button>
                    <span>{captures.findIndex((capture) => capture.id === selected.id) + 1} / {captures.length} · {selected.id.replace("field-capture-", "")}</span>
                    <button disabled={captures.findIndex((capture) => capture.id === selected.id) >= captures.length - 1} onClick={() => chooseAdjacentCapture(1)}>下一组 →</button>
                  </div>
                )}
              </div>
              <div style={styles.reviewColumn}>
                <div style={styles.controls}>
                  <label>动作<select value={exerciseId} onChange={(event) => { setExerciseId(event.target.value); setDraftSegments([]); setDraftCandidateId(null); }}><option value="">请确认动作</option>{MUSCLE_GROUPS.map((group) => <optgroup key={group.id} label={`${group.labelZh}部`}>{EXERCISE_REGISTRY.exercises.filter((exercise) => exercise.muscleGroup === group.id && (!selected.inboxItem || exercise.maturity === "catalog_only")).map((exercise) => <option key={exercise.id} value={exercise.id}>{exercise.nameZh} · {exercise.maturity === "catalog_only" ? "仅采集" : "实验"}</option>)}</optgroup>)}</select>{selected.inboxItem && <small>待标注收件箱只建立尚无 Rust profile 的动作真值，不在 TypeScript 中替代正式计数。</small>}</label>
                  <label>实际机位<select value={capturePosition} onChange={(event) => { const position = event.target.value as CapturePosition | ""; setCapturePosition(position); const view = analysisViewFor(position); if (view) setCameraView(view); setDraftSegments([]); setDraftCandidateId(null); }}><option value="">请确认实际机位</option>{CAPTURE_POSITIONS.map((position) => <option key={position.id} value={position.id}>{position.label}</option>)}</select><small>分析视角：{analysisViewFor(capturePosition) ?? "未确认"}</small></label>
                  <label>你实际做了<input inputMode="numeric" value={expectedCount} onChange={(event) => setExpectedCount(event.target.value)} placeholder="次数" /> 次</label>
                  <label style={{ gridColumn: "1 / -1" }}>备注<textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="例如：底部有停顿、左臂被器械遮挡、这一组不作为动作质量标准" rows={2} /></label>
                </div>
                <div style={styles.candidates}>
                  {candidates.map((candidate) => (
                    <article key={candidate.id} style={{ ...styles.candidate, ...(candidate.tone === "current" ? styles.current : candidate.tone === "caution" ? styles.caution : {}) }}>
                      <div><small>{candidate.label}</small><strong>{candidate.count} REPS</strong></div>
                      <p>{candidate.score} · {candidate.reason}</p>
                      <div style={styles.repButtons}>{candidate.segments.map((segment) => <button key={segment.repIndex} onClick={() => seekReviewVideo(segment.startMs)}>#{segment.repIndex}</button>)}</div>
                      <button style={styles.approve} onClick={() => selectDraftSegments(candidate)}>{draftCandidateId === candidate.id ? "当前待审核分段" : "选择此分段进行逐 rep 审核"}</button>
                    </article>
                  ))}
                </div>
                {draftCandidateId && (
                  <div style={styles.segmentEditor}>
                    <strong>逐 rep 审核 · {draftSegments.length} 段</strong>
                    <p>绿色范围已经自动保存。优先在视频下方时间轴拖选；只有需要逐毫秒修正时再展开下面的高级编辑。</p>
                    <div style={styles.segmentNotes}>
                      {draftSegments.map((segment) => (
                        <label key={`note-${segment.repIndex}`} style={styles.segmentNoteRow}>
                          <span>#{segment.repIndex} · {formatTimelineTime(segment.startMs)}–{formatTimelineTime(segment.endMs)}</span>
                          <input
                            value={segment.note ?? ""}
                            onChange={(event) => updateDraftSegmentNote(segment.repIndex, event.target.value)}
                            placeholder="描述这一段：换边、遮挡、借力、力竭……"
                          />
                        </label>
                      ))}
                    </div>
                    <details>
                      <summary style={styles.segmentSummary}>精确时间微调（可选）</summary>
                      {draftSegments.map((segment) => (
                        <div key={segment.repIndex} style={styles.segmentRow}>
                          <b>#{segment.repIndex}</b>
                          <label>start<input inputMode="numeric" value={segment.startMs} onChange={(event) => updateDraftSegment(segment.repIndex, "startMs", Number(event.target.value))} /></label>
                          <label>peak<input inputMode="numeric" value={segment.peakMs} onChange={(event) => updateDraftSegment(segment.repIndex, "peakMs", Number(event.target.value))} /></label>
                          <label>end<input inputMode="numeric" value={segment.endMs} onChange={(event) => updateDraftSegment(segment.repIndex, "endMs", Number(event.target.value))} /></label>
                          <button onClick={() => removeDraftSegment(segment.repIndex)}>移除</button>
                        </div>
                      ))}
                    </details>
                    <div style={styles.segmentActions}>
                      <button onClick={addDraftSegment}>+ 添加 rep</button>
                      <button disabled={!segmentUndoStack.length} onClick={undoTimelineSegments}>↶ 撤回</button>
                      <button style={styles.approve} disabled={inboxWork !== null} onClick={() => void approve()}>批准此逐 rep 真值</button>
                    </div>
                  </div>
                )}
                {approvals[selected.id] && <p style={styles.approved}>✓ 已批准：{approvals[selected.id].candidateId}；实际 {approvals[selected.id].expectedCount || "未填写"} 次 · {approvals[selected.id].trainingSide ?? "未标侧别"}{approvals[selected.id].variation ? ` · ${approvals[selected.id].variation}` : ""}{approvals[selected.id].note ? ` · 备注：${approvals[selected.id].note}` : ""} · 审核版本 {approvals[selected.id].analysisVersions?.length ?? 1}（每版保留弱负样本）</p>}
                {!!selected.metadata?.rustRejectedReps?.length && <p style={styles.trajectoryWarning}>Rust 已过滤 {selected.metadata.rustRejectedReps.length} 个候选：{[...new Set(selected.metadata.rustRejectedReps.map((candidate) => candidate.evidenceReason ?? "未说明"))].join("、")}。它们保留为证据，不能直接批准为正式次数。</p>}
                {approvals[selected.id]?.exerciseId === "lat_pulldown" && (
                  selectedTrajectoryDecision?.sample ? (
                    <p style={selectedTrajectoryDecision.decision === "eligible" ? styles.trajectoryReady : styles.trajectoryWarning}>
                      轨迹库：{selectedTrajectoryDecision.decision === "eligible" ? "可用于分段训练（非标准动作模板）" : "已隔离，不参与训练"} · 特征覆盖 {Math.round(selectedTrajectoryDecision.sample.quality.meanFeatureCoverage * 100)}%
                    </p>
                  ) : selectedTrajectoryDecision ? <p style={styles.trajectoryWarning}>轨迹库：已隔离 · {selectedTrajectoryDecision.reason}</p> : <p style={styles.trajectoryWarning}>轨迹库：旧审批尚未固化轨迹，请重新批准一次。</p>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

const styles: Record<string, React.CSSProperties> = {
  shell: { marginTop: 22, border: "1px solid #2d5a52", background: "linear-gradient(135deg,#071310,#0a1717 55%,#101313)", color: "#d8eee4", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", boxShadow: "0 18px 42px rgba(0,0,0,.26)" },
  header: { display: "flex", gap: 16, alignItems: "center", justifyContent: "space-between", padding: "18px 20px", borderBottom: "1px solid #24443e" },
  kicker: { color: "#7cffbc", fontSize: 10, letterSpacing: 1.7 },
  title: { margin: "5px 0", fontSize: 21, letterSpacing: 1 },
  subtitle: { margin: 0, color: "#89aaa1", fontSize: 12 },
  inboxBar: { display: "flex", alignItems: "center", gap: 12, padding: "11px 20px", borderBottom: "1px solid #315b50", background: "#0d261f", color: "#d8eee4", fontSize: 11 },
  inboxProgress: { color: "#ffcf83", whiteSpace: "nowrap" },
  inboxWarning: { margin: 16, color: "#ffbd6f", fontSize: 12 },
  importButton: { border: "1px solid #72e6a8", background: "#123b2d", color: "#dffff0", padding: "10px 13px", cursor: "pointer", font: "inherit", fontSize: 12 },
  manualImport: { border: "1px solid #42685d", background: "#0b201a", color: "#b8d7cc", padding: "10px 11px", cursor: "pointer", font: "inherit", fontSize: 12 },
  error: { margin: 16, color: "#ff9b83" },
  exportNotice: { margin: 16, color: "#7cffbc", fontSize: 12 },
  empty: { padding: 22, color: "#89aaa1" },
  replayShell: { borderBottom: "1px solid #24443e", background: "linear-gradient(90deg, rgba(17,51,42,.66), rgba(7,19,16,.32))" },
  replayIntro: { display: "flex", justifyContent: "space-between", gap: 16, alignItems: "end", padding: "16px 20px 12px" },
  replayTitle: { margin: "5px 0", fontSize: 16, letterSpacing: .6 },
  replayCopy: { margin: 0, maxWidth: 640, color: "#89aaa1", fontSize: 11, lineHeight: 1.5 },
  metrics: { display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: 10, color: "#b8d7cc", fontSize: 11, textAlign: "right" },
  replayRows: { maxHeight: 260, overflowY: "auto", borderTop: "1px solid #24443e", padding: 7, display: "grid", gap: 4 },
  replayRow: { display: "grid", gridTemplateColumns: "44px 104px 128px minmax(172px, .8fr) minmax(126px, .68fr) minmax(190px, 1fr)", alignItems: "center", gap: 8, width: "100%", padding: "8px 9px", color: "#b8d7cc", background: "rgba(5,15,13,.3)", border: "1px solid transparent", cursor: "pointer", textAlign: "left", font: "inherit", fontSize: 10 },
  replayRowActive: { borderColor: "#5bc795", background: "#12342c", color: "#effff6" },
  priority: { padding: "3px 4px", textAlign: "center", fontSize: 9, letterSpacing: .5 },
  priorityHigh: { color: "#1a1000", background: "#ffbd6f" },
  priorityNormal: { color: "#101c1a", background: "#a8d6c0" },
  priorityLow: { color: "#042215", background: "#7cffbc" },
  replayStamp: { color: "#d8eee4" },
  replayAction: { color: "#84d8ad" },
  replayNumbers: { color: "#e5c78a" },
  replayQuality: { color: "#91b9aa" },
  replayReason: { color: "#78988d", lineHeight: 1.35 },
  grid: { display: "grid", gridTemplateColumns: "minmax(200px, .55fr) minmax(0, 1.8fr)", minHeight: 440 },
  compactGrid: { minHeight: 440 },
  ledger: { borderRight: "1px solid #24443e", maxHeight: 610, overflowY: "auto", padding: 8 },
  capture: { width: "100%", display: "grid", gap: 5, padding: 11, marginBottom: 5, textAlign: "left", color: "#abc7be", background: "transparent", border: "1px solid transparent", cursor: "pointer", font: "inherit", fontSize: 11 },
  captureActive: { background: "#12342c", borderColor: "#4ca97a", color: "#ecfff5" },
  detail: { display: "grid", gridTemplateColumns: "minmax(270px, 1fr) minmax(350px, 1.25fr)", gap: 16, padding: 16 },
  videoColumn: { minWidth: 0 },
  video: { width: "100%", maxHeight: 430, background: "#000", border: "1px solid #30564b" },
  timelineShell: { marginTop: 8, padding: "11px 12px 9px", border: "1px solid #345f54", background: "linear-gradient(180deg,#0a1b17,#07110f)", boxShadow: "inset 0 0 24px rgba(0,0,0,.36)" },
  timelineHeader: { display: "flex", justifyContent: "space-between", alignItems: "end", gap: 10, marginBottom: 9, color: "#d8eee4", fontSize: 10, letterSpacing: .7 },
  timelineHeaderActions: { display: "flex", alignItems: "center", gap: 6, flexShrink: 0 },
  timelineCounter: { flexShrink: 0, color: "#ffbd6f", fontSize: 10 },
  timelineTrack: { position: "relative", height: 58, overflow: "hidden", border: "1px solid #4b7569", background: "repeating-linear-gradient(90deg,rgba(124,255,188,.04) 0,rgba(124,255,188,.04) 1px,transparent 1px,transparent 12px),linear-gradient(180deg,#0c2920,#081713)", cursor: "crosshair", touchAction: "none", userSelect: "none" },
  timelineTick: { position: "absolute", top: 0, bottom: 0, width: 1, background: "rgba(137,170,161,.22)", pointerEvents: "none" },
  timelineRep: { position: "absolute", top: 10, bottom: 10, minWidth: 5, overflow: "hidden", border: "1px solid #75e2aa", background: "linear-gradient(90deg,rgba(31,142,92,.78),rgba(89,211,148,.58))", color: "#effff6", font: "700 9px ui-monospace,monospace", cursor: "pointer", zIndex: 3, boxShadow: "0 0 12px rgba(85,225,153,.18)" },
  timelineRepSelected: { top: 6, bottom: 6, overflow: "visible", border: "1px solid #ffe09a", cursor: "grab", zIndex: 6, boxShadow: "0 0 0 1px rgba(255,224,154,.55),0 0 18px rgba(255,189,111,.28)" },
  timelineHandle: { position: "absolute", top: -5, bottom: -5, width: 12, background: "#ffcf83", border: "1px solid #fff0c7", cursor: "ew-resize", zIndex: 7, boxShadow: "0 0 7px rgba(255,189,111,.5)" },
  timelinePeak: { position: "absolute", top: 0, bottom: 0, width: 2, background: "#ffe099", boxShadow: "0 0 6px #ffbd6f", pointerEvents: "none" },
  timelineSelection: { position: "absolute", top: 5, bottom: 5, minWidth: 2, border: "1px solid #ffca83", background: "rgba(255,177,76,.28)", boxShadow: "0 0 16px rgba(255,177,76,.25)", pointerEvents: "none", zIndex: 4 },
  timelinePlayhead: { position: "absolute", top: 0, bottom: 0, width: 2, marginLeft: -1, background: "#f3f6f4", boxShadow: "0 0 7px rgba(255,255,255,.8)", pointerEvents: "none", zIndex: 5 },
  timelineFooter: { display: "flex", justifyContent: "space-between", marginTop: 6, color: "#729287", fontSize: 9, fontVariantNumeric: "tabular-nums" },
  qualityStrip: { display: "flex", gap: 13, flexWrap: "wrap", padding: "8px 0", color: "#80aa9a", fontSize: 11 },
  reviewNavigation: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, color: "#89aaa1", fontSize: 10 },
  reviewColumn: { minWidth: 0 },
  controls: { display: "grid", gridTemplateColumns: "1.4fr .8fr .9fr", gap: 8, marginBottom: 10 },
  candidates: { display: "grid", gap: 8 },
  candidate: { border: "1px solid #315149", padding: 10, background: "#0c1c19" },
  current: { borderColor: "#61cd99", background: "#0c261e" },
  caution: { borderColor: "#87623b", background: "#211a11" },
  segmentEditor: { marginTop: 11, border: "1px solid #4a806a", background: "#0a211a", padding: 10, color: "#cce8dc", fontSize: 11 },
  segmentNotes: { display: "grid", gap: 5, maxHeight: 210, overflowY: "auto", paddingRight: 3 },
  segmentNoteRow: { display: "grid", gridTemplateColumns: "130px minmax(0,1fr)", alignItems: "center", gap: 7, color: "#89aaa1", fontSize: 10 },
  segmentSummary: { margin: "8px 0", color: "#89aaa1", cursor: "pointer" },
  segmentRow: { display: "grid", gridTemplateColumns: "34px repeat(3, minmax(75px, 1fr)) 42px", gap: 5, alignItems: "end", padding: "7px 0", borderBottom: "1px solid #24443e" },
  segmentActions: { display: "flex", gap: 8, marginTop: 9 },
  repButtons: { display: "flex", gap: 4, flexWrap: "wrap", margin: "8px 0" },
  approve: { border: "1px solid #69df9f", background: "#174631", color: "#e6fff0", padding: "5px 8px", cursor: "pointer", font: "inherit", fontSize: 11 },
  approved: { color: "#8affbd", fontSize: 12 },
  trajectoryReady: { margin: "7px 0 0", color: "#7cffbc", fontSize: 12 },
  trajectoryWarning: { margin: "7px 0 0", color: "#ffbd6f", fontSize: 12, lineHeight: 1.5 },
};
