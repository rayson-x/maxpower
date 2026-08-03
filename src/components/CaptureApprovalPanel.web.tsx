import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { EXERCISE_REGISTRY, MUSCLE_GROUPS } from "../pose/exerciseRegistry";
import type { CameraView } from "../pose/formRuleEngine";
import { analyzePoseSet } from "../pose/poseSetAnalysis";
import type { PoseEstimate } from "../pose/PoseEngine";
import { segmentRepsAuto } from "../pose/repSegmenter";
import { selectTrainingWindow } from "../pose/trainingWindow";
import {
  buildApprovedLatPulldownTrajectorySample,
  type LatPulldownTrajectorySample,
} from "../pose/trajectoryDataset";
import { CAPTURE_POSITIONS, type CapturePosition } from "../pose/viewGating";

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
}

interface ImportedFixture {
  video: string;
  durationSec: number;
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
}

interface ReviewDraft {
  exerciseId: string;
  cameraView: CameraView;
  capturePosition: CapturePosition | "";
  expectedCount: string;
  draftCandidateId: string | null;
  draftSegments: Candidate["segments"];
  note: string;
  updatedAt: string;
}

interface Candidate {
  id: string;
  label: string;
  count: number;
  score: string;
  reason: string;
  segments: Array<{ repIndex: number; startMs: number; peakMs: number; endMs: number }>;
  tone: "recorded" | "current" | "caution";
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

function downloadJson(value: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
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
  const automatic = segmentRepsAuto(stable.poses);
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

async function parseCaptureFiles(files: File[]): Promise<ReviewCapture[]> {
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
      });
    } catch {
      // A non-capture JSON in Downloads is not a review failure.
    }
  }
  return captures.sort((a, b) => b.id.localeCompare(a.id));
}

async function loadProjectCaptures(): Promise<ReviewCapture[]> {
  const manifestResponse = await fetch("/field-captures/manifest.json", { cache: "no-store" });
  if (!manifestResponse.ok) throw new Error("项目采集库清单不可用");
  const manifest = await manifestResponse.json() as ProjectManifest;
  const captures = await Promise.all(
    manifest.captures.map(async (entry) => {
      const fixtureResponse = await fetch(`/field-captures/${entry.keypoints}`, { cache: "no-store" });
      if (!fixtureResponse.ok) throw new Error(`无法读取 ${entry.keypoints}`);
      const parsed = await fixtureResponse.json() as ImportedFixture[];
      const labels = entry.labels
        ? await fetch(`/field-captures/${entry.labels}`, { cache: "no-store" }).then(async (response) =>
            response.ok ? await response.json() as ImportedLabels : null,
          )
        : null;
      const metadata = entry.metadata
        ? await fetch(`/field-captures/${entry.metadata}`, { cache: "no-store" }).then(async (response) =>
            response.ok ? await response.json() as ImportedCaptureMetadata : null,
          )
        : null;
      const fixture = parsed[0];
      if (!fixture || !Array.isArray(fixture.poses)) throw new Error(`采集关键点格式无效: ${entry.id}`);
      return {
        id: entry.id,
        videoUrl: `/field-captures/${entry.video}`,
        sourceSignature: entry.id,
        revokeVideoUrl: false,
        fixture,
        labels: labels ? { ...metadata, ...labels } : metadata?.exerciseId ? metadata : null,
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
  const capturesRef = useRef<ReviewCapture[]>([]);
  const selectedIdRef = useRef<string | null>(null);
  const approvalsRef = useRef<Record<string, Approval>>(loadApprovals());
  const draftsRef = useRef<Record<string, ReviewDraft>>(loadDrafts());
  const [captures, setCaptures] = useState<ReviewCapture[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [approvals, setApprovals] = useState<Record<string, Approval>>(approvalsRef.current);
  const [exerciseId, setExerciseId] = useState("");
  const [cameraView, setCameraView] = useState<CameraView>("oblique45");
  const [capturePosition, setCapturePosition] = useState<CapturePosition | "">("");
  const [expectedCount, setExpectedCount] = useState("");
  const [draftSegments, setDraftSegments] = useState<Candidate["segments"]>([]);
  const [draftCandidateId, setDraftCandidateId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [directoryConnected, setDirectoryConnected] = useState(false);

  const selected = captures.find((capture) => capture.id === selectedId) ?? null;
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
        note,
        updatedAt: new Date().toISOString(),
      },
    };
    draftsRef.current = next;
    saveDrafts(next);
  }, [cameraView, capturePosition, draftCandidateId, draftSegments, exerciseId, expectedCount, note, selectedId]);

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
      setNote(storedApproval?.note ?? savedDraft?.note ?? "");
    }
    return true;
  };

  const importFiles = async (files: File[]) => {
    setError(null);
    const loaded = await parseCaptureFiles(files);
    if (!installCaptures(loaded)) {
      setError("没有找到完整采集包：每组需要同名的 .webm/.mp4/.mov 与 .json 文件。");
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
      const loaded = await parseCaptureFiles(await filesFromDirectory(saved));
      if (installCaptures(loaded)) setDirectoryConnected(true);
    } catch {
      // A browser can revoke a persisted handle. The manual import control
      // remains available and is the recovery path.
      setDirectoryConnected(false);
    }
  };

  useEffect(() => {
    void loadProjectCaptures()
      .then((loaded) => {
        if (!installCaptures(loaded)) setError("项目采集库中没有完整采集包。");
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)));
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
    setNote(storedApproval?.note ?? savedDraft?.note ?? "");
  };

  const chooseAdjacentCapture = (direction: -1 | 1) => {
    if (!captures.length) return;
    const currentIndex = Math.max(0, captures.findIndex((capture) => capture.id === selected?.id));
    const nextIndex = Math.min(captures.length - 1, Math.max(0, currentIndex + direction));
    chooseCapture(captures[nextIndex]);
  };

  const selectDraftSegments = (candidate: Candidate) => {
    setError(null);
    setDraftCandidateId(candidate.id);
    setDraftSegments(candidate.segments.map((segment) => ({ ...segment })));
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

  const addDraftSegment = () => {
    const last = draftSegments.at(-1);
    const startMs = last ? last.endMs + 1 : selected?.fixture.poses[0]?.timestampMs ?? 0;
    setDraftSegments((current) => [...current, {
      repIndex: (last?.repIndex ?? 0) + 1,
      startMs,
      peakMs: startMs + 250,
      endMs: startMs + 500,
    }]);
  };

  const approve = () => {
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
    const next: Record<string, Approval> = {
      ...approvals,
      [selected.id]: {
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
      },
    };
    approvalsRef.current = next;
    setApprovals(next);
    localStorage.setItem(APPROVAL_KEY, JSON.stringify(next));
    // Approval is a deliberate user click, so save a portable copy immediately
    // rather than making the athlete remember a second export step.
    downloadJson(
      { version: "capture-approval/v1", approvals: next },
      `field-capture-approval-${selected.id}.json`,
    );
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
  };

  const exportApprovals = () => {
    // Read at click time: exports must survive a page remount and must include
    // the unapproved local drafts the athlete is actively editing.
    downloadJson({
      version: "capture-approval/v2",
      exportedAt: new Date().toISOString(),
      approvals: loadApprovals(),
      drafts: loadDrafts(),
    }, `field-capture-approvals-${new Date().toISOString().slice(0, 10)}.json`);
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
          <button style={styles.manualImport} disabled={!Object.keys(approvals).length} onClick={exportApprovals}>导出审批真值</button>
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
      {error && <p style={styles.error}>{error}</p>}
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
        <p style={styles.empty}>选择 Downloads 文件夹。面板会自动配对同名的视频、关键点和 labels 文件。</p>
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
                <video data-capture-review-video key={selected.id} src={selected.videoUrl} controls preload="metadata" style={styles.video} />
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
                  <label>动作<select value={exerciseId} onChange={(event) => { setExerciseId(event.target.value); setDraftSegments([]); setDraftCandidateId(null); }}><option value="">请确认动作</option>{MUSCLE_GROUPS.map((group) => <optgroup key={group.id} label={`${group.labelZh}部`}>{EXERCISE_REGISTRY.exercises.filter((exercise) => exercise.muscleGroup === group.id).map((exercise) => <option key={exercise.id} value={exercise.id}>{exercise.nameZh} · {exercise.maturity === "catalog_only" ? "仅采集" : "实验"}</option>)}</optgroup>)}</select></label>
                  <label>实际机位<select value={capturePosition} onChange={(event) => { const position = event.target.value as CapturePosition | ""; setCapturePosition(position); const view = analysisViewFor(position); if (view) setCameraView(view); setDraftSegments([]); setDraftCandidateId(null); }}><option value="">请确认实际机位</option>{CAPTURE_POSITIONS.map((position) => <option key={position.id} value={position.id}>{position.label}</option>)}</select><small>分析视角：{analysisViewFor(capturePosition) ?? "未确认"}</small></label>
                  <label>你实际做了<input inputMode="numeric" value={expectedCount} onChange={(event) => setExpectedCount(event.target.value)} placeholder="次数" /> 次</label>
                  <label style={{ gridColumn: "1 / -1" }}>备注<textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="例如：底部有停顿、左臂被器械遮挡、这一组不作为动作质量标准" rows={2} /></label>
                </div>
                <div style={styles.candidates}>
                  {candidates.map((candidate) => (
                    <article key={candidate.id} style={{ ...styles.candidate, ...(candidate.tone === "current" ? styles.current : candidate.tone === "caution" ? styles.caution : {}) }}>
                      <div><small>{candidate.label}</small><strong>{candidate.count} REPS</strong></div>
                      <p>{candidate.score} · {candidate.reason}</p>
                      <div style={styles.repButtons}>{candidate.segments.map((segment) => <button key={segment.repIndex} onClick={() => { const video = document.querySelector<HTMLVideoElement>("[data-capture-review-video]"); if (video) video.currentTime = segment.startMs / 1000; }}>#{segment.repIndex}</button>)}</div>
                      <button style={styles.approve} onClick={() => selectDraftSegments(candidate)}>{draftCandidateId === candidate.id ? "当前待审核分段" : "选择此分段进行逐 rep 审核"}</button>
                    </article>
                  ))}
                </div>
                {draftCandidateId && (
                  <div style={styles.segmentEditor}>
                    <strong>逐 rep 边界审核 · {draftCandidateId}</strong>
                    <p>对照视频逐个确认；可直接修正 start / 拉到底峰值 / end（毫秒）。未选择候选不能批准入库。</p>
                    {draftSegments.map((segment) => (
                      <div key={segment.repIndex} style={styles.segmentRow}>
                        <b>#{segment.repIndex}</b>
                        <label>start<input inputMode="numeric" value={segment.startMs} onChange={(event) => updateDraftSegment(segment.repIndex, "startMs", Number(event.target.value))} /></label>
                        <label>peak<input inputMode="numeric" value={segment.peakMs} onChange={(event) => updateDraftSegment(segment.repIndex, "peakMs", Number(event.target.value))} /></label>
                        <label>end<input inputMode="numeric" value={segment.endMs} onChange={(event) => updateDraftSegment(segment.repIndex, "endMs", Number(event.target.value))} /></label>
                        <button onClick={() => setDraftSegments((current) => current.filter((item) => item.repIndex !== segment.repIndex))}>移除</button>
                      </div>
                    ))}
                    <div style={styles.segmentActions}>
                      <button onClick={addDraftSegment}>+ 添加 rep</button>
                      <button style={styles.approve} onClick={approve}>批准此逐 rep 真值</button>
                    </div>
                  </div>
                )}
                {approvals[selected.id] && <p style={styles.approved}>✓ 已批准：{approvals[selected.id].candidateId}；实际 {approvals[selected.id].expectedCount || "未填写"} 次 · {approvals[selected.id].trainingSide ?? "未标侧别"}{approvals[selected.id].variation ? ` · ${approvals[selected.id].variation}` : ""}{approvals[selected.id].note ? ` · 备注：${approvals[selected.id].note}` : ""}</p>}
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
  importButton: { border: "1px solid #72e6a8", background: "#123b2d", color: "#dffff0", padding: "10px 13px", cursor: "pointer", font: "inherit", fontSize: 12 },
  manualImport: { border: "1px solid #42685d", background: "#0b201a", color: "#b8d7cc", padding: "10px 11px", cursor: "pointer", font: "inherit", fontSize: 12 },
  error: { margin: 16, color: "#ff9b83" },
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
  qualityStrip: { display: "flex", gap: 13, flexWrap: "wrap", padding: "8px 0", color: "#80aa9a", fontSize: 11 },
  reviewNavigation: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, color: "#89aaa1", fontSize: 10 },
  reviewColumn: { minWidth: 0 },
  controls: { display: "grid", gridTemplateColumns: "1.4fr .8fr .9fr", gap: 8, marginBottom: 10 },
  candidates: { display: "grid", gap: 8 },
  candidate: { border: "1px solid #315149", padding: 10, background: "#0c1c19" },
  current: { borderColor: "#61cd99", background: "#0c261e" },
  caution: { borderColor: "#87623b", background: "#211a11" },
  segmentEditor: { marginTop: 11, border: "1px solid #4a806a", background: "#0a211a", padding: 10, color: "#cce8dc", fontSize: 11 },
  segmentRow: { display: "grid", gridTemplateColumns: "34px repeat(3, minmax(75px, 1fr)) 42px", gap: 5, alignItems: "end", padding: "7px 0", borderBottom: "1px solid #24443e" },
  segmentActions: { display: "flex", gap: 8, marginTop: 9 },
  repButtons: { display: "flex", gap: 4, flexWrap: "wrap", margin: "8px 0" },
  approve: { border: "1px solid #69df9f", background: "#174631", color: "#e6fff0", padding: "5px 8px", cursor: "pointer", font: "inherit", fontSize: 11 },
  approved: { color: "#8affbd", fontSize: 12 },
  trajectoryReady: { margin: "7px 0 0", color: "#7cffbc", fontSize: 12 },
  trajectoryWarning: { margin: "7px 0 0", color: "#ffbd6f", fontSize: 12, lineHeight: 1.5 },
};
