import { useEffect, useMemo, useRef, useState } from "react";

import { EXERCISE_REGISTRY, MUSCLE_GROUPS } from "../pose/exerciseRegistry";
import type { CameraView } from "../pose/formRuleEngine";
import { analyzePoseSet } from "../pose/poseSetAnalysis";
import type { PoseEstimate } from "../pose/PoseEngine";
import { segmentRepsAuto } from "../pose/repSegmenter";
import { selectTrainingWindow } from "../pose/trainingWindow";

interface ImportedLabels {
  exerciseId?: string;
  cameraView?: CameraView;
  variation?: string | null;
  trainingSide?: "bilateral" | "left" | "right";
  profileVersion?: string | null;
  model?: string | null;
  labels?: Array<{ repIndex: number; startMs: number; extremeMs: number; endMs: number }>;
}

interface ImportedCaptureMetadata {
  exerciseId?: string | null;
  cameraView?: CameraView;
  variation?: string | null;
  trainingSide?: "bilateral" | "left" | "right";
  profileVersion?: string | null;
  model?: string | null;
}

interface ImportedFixture {
  video: string;
  durationSec: number;
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
  captures: Array<{ id: string; video: string; keypoints: string; labels: string }>;
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
const SOURCE_DATABASE = "form-coach-review-source";
const SOURCE_STORE = "settings";
const SOURCE_KEY = "downloads-directory";
const VIEW_OPTIONS: Array<{ id: CameraView; label: string }> = [
  { id: "front", label: "正前" },
  { id: "oblique45", label: "45°" },
  { id: "side", label: "侧面" },
];

function baseName(name: string): string {
  return name.replace(/\.labels\.json$/i, "").replace(/\.(webm|mp4|mov|json)$/i, "");
}

function loadApprovals(): Record<string, Approval> {
  try {
    return JSON.parse(localStorage.getItem(APPROVAL_KEY) ?? "{}") as Record<string, Approval>;
  } catch {
    return {};
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
  return captures.map((capture) => {
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
      const fixture = parsed[0];
      if (!fixture || !Array.isArray(fixture.poses)) throw new Error(`采集关键点格式无效: ${entry.id}`);
      return {
        id: entry.id,
        videoUrl: `/field-captures/${entry.video}`,
        sourceSignature: entry.id,
        revokeVideoUrl: false,
        fixture,
        labels,
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
export function CaptureApprovalPanel() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const capturesRef = useRef<ReviewCapture[]>([]);
  const selectedIdRef = useRef<string | null>(null);
  const approvalsRef = useRef<Record<string, Approval>>(loadApprovals());
  const [captures, setCaptures] = useState<ReviewCapture[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [approvals, setApprovals] = useState<Record<string, Approval>>(approvalsRef.current);
  const [exerciseId, setExerciseId] = useState("");
  const [cameraView, setCameraView] = useState<CameraView>("oblique45");
  const [expectedCount, setExpectedCount] = useState("");
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
      setExerciseId(next.labels?.exerciseId ?? "");
      setCameraView(next.labels?.cameraView ?? "oblique45");
      setExpectedCount(approvalsRef.current[next.id]?.expectedCount ?? "");
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
    selectedIdRef.current = capture.id;
    setSelectedId(capture.id);
    setExerciseId(capture.labels?.exerciseId ?? "");
    setCameraView(capture.labels?.cameraView ?? "oblique45");
    setExpectedCount(approvals[capture.id]?.expectedCount ?? "");
  };

  const approve = (candidateId: string) => {
    if (!selected) return;
    const candidate = candidates.find((item) => item.id === candidateId);
    const next = {
      ...approvals,
      [selected.id]: {
        expectedCount,
        candidateId,
        candidateCount: candidate?.count ?? 0,
        exerciseId,
        cameraView,
        variation: selected.labels?.variation ?? null,
        trainingSide: selected.labels?.trainingSide ?? null,
        profileVersion: selected.labels?.profileVersion ?? null,
        model: selected.fixture.model,
        approvedSegments: candidate?.segments ?? [],
        approvedAt: new Date().toISOString(),
      },
    };
    approvalsRef.current = next;
    setApprovals(next);
    localStorage.setItem(APPROVAL_KEY, JSON.stringify(next));
  };

  const exportApprovals = () => {
    const blob = new Blob([JSON.stringify({ version: "capture-approval/v1", approvals }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `field-capture-approvals-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  return (
    <section style={styles.shell}>
      <header style={styles.header}>
        <div>
          <div style={styles.kicker}>FIELD EVIDENCE / 本机审核</div>
          <h2 style={styles.title}>训练录像审批台</h2>
          <p style={styles.subtitle}>{directoryConnected ? "Downloads 已连接 · 每 10 秒自动加载新的导出包" : "同一关键点序列的固定回放对比；审批结果只保存在这台设备。"}</p>
        </div>
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
          <button style={styles.importButton} onClick={() => void importDirectory()}>导入 Downloads 采集包</button>
          <button style={styles.manualImport} onClick={() => fileInputRef.current?.click()}>手动选择文件</button>
          <button style={styles.manualImport} disabled={!Object.keys(approvals).length} onClick={exportApprovals}>导出审批真值</button>
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
      {!!replayReport.length && (
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
        <div style={styles.grid}>
          <nav style={styles.ledger} aria-label="采集组列表">
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
          </nav>
          {selected && quality && (
            <div style={styles.detail}>
              <div style={styles.videoColumn}>
                <video data-capture-review-video key={selected.id} src={selected.videoUrl} controls preload="metadata" style={styles.video} />
                <div style={styles.qualityStrip}>
                  <span>POSE {quality.posePercent}%</span><span>躯干完整 {quality.torsoPercent}%</span><span>{quality.frames} 帧</span>
                </div>
              </div>
              <div style={styles.reviewColumn}>
                <div style={styles.controls}>
                  <label>动作<select value={exerciseId} onChange={(event) => setExerciseId(event.target.value)}><option value="">请确认动作</option>{MUSCLE_GROUPS.map((group) => <optgroup key={group.id} label={`${group.labelZh}部`}>{EXERCISE_REGISTRY.exercises.filter((exercise) => exercise.muscleGroup === group.id).map((exercise) => <option key={exercise.id} value={exercise.id}>{exercise.nameZh} · {exercise.maturity === "catalog_only" ? "仅采集" : "实验"}</option>)}</optgroup>)}</select></label>
                  <label>机位<select value={cameraView} onChange={(event) => setCameraView(event.target.value as CameraView)}>{VIEW_OPTIONS.map((view) => <option key={view.id} value={view.id}>{view.label}</option>)}</select></label>
                  <label>你实际做了<input inputMode="numeric" value={expectedCount} onChange={(event) => setExpectedCount(event.target.value)} placeholder="次数" /> 次</label>
                </div>
                <div style={styles.candidates}>
                  {candidates.map((candidate) => (
                    <article key={candidate.id} style={{ ...styles.candidate, ...(candidate.tone === "current" ? styles.current : candidate.tone === "caution" ? styles.caution : {}) }}>
                      <div><small>{candidate.label}</small><strong>{candidate.count} REPS</strong></div>
                      <p>{candidate.score} · {candidate.reason}</p>
                      <div style={styles.repButtons}>{candidate.segments.map((segment) => <button key={segment.repIndex} onClick={() => { const video = document.querySelector<HTMLVideoElement>("[data-capture-review-video]"); if (video) video.currentTime = segment.startMs / 1000; }}>#{segment.repIndex}</button>)}</div>
                      <button style={styles.approve} onClick={() => approve(candidate.id)}>批准为本组真值</button>
                    </article>
                  ))}
                </div>
                {approvals[selected.id] && <p style={styles.approved}>✓ 已批准：{approvals[selected.id].candidateId}；实际 {approvals[selected.id].expectedCount || "未填写"} 次 · {approvals[selected.id].trainingSide ?? "未标侧别"}{approvals[selected.id].variation ? ` · ${approvals[selected.id].variation}` : ""}</p>}
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
  ledger: { borderRight: "1px solid #24443e", maxHeight: 610, overflowY: "auto", padding: 8 },
  capture: { width: "100%", display: "grid", gap: 5, padding: 11, marginBottom: 5, textAlign: "left", color: "#abc7be", background: "transparent", border: "1px solid transparent", cursor: "pointer", font: "inherit", fontSize: 11 },
  captureActive: { background: "#12342c", borderColor: "#4ca97a", color: "#ecfff5" },
  detail: { display: "grid", gridTemplateColumns: "minmax(270px, 1fr) minmax(350px, 1.25fr)", gap: 16, padding: 16 },
  videoColumn: { minWidth: 0 },
  video: { width: "100%", maxHeight: 430, background: "#000", border: "1px solid #30564b" },
  qualityStrip: { display: "flex", gap: 13, flexWrap: "wrap", padding: "8px 0", color: "#80aa9a", fontSize: 11 },
  reviewColumn: { minWidth: 0 },
  controls: { display: "grid", gridTemplateColumns: "1.4fr .8fr .9fr", gap: 8, marginBottom: 10 },
  candidates: { display: "grid", gap: 8 },
  candidate: { border: "1px solid #315149", padding: 10, background: "#0c1c19" },
  current: { borderColor: "#61cd99", background: "#0c261e" },
  caution: { borderColor: "#87623b", background: "#211a11" },
  repButtons: { display: "flex", gap: 4, flexWrap: "wrap", margin: "8px 0" },
  approve: { border: "1px solid #69df9f", background: "#174631", color: "#e6fff0", padding: "5px 8px", cursor: "pointer", font: "inherit", fontSize: 11 },
  approved: { color: "#8affbd", fontSize: 12 },
};
