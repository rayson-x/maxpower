import { useEffect, useMemo, useRef, useState } from "react";

import { EXERCISE_REGISTRY } from "../pose/exerciseRegistry";
import type { CameraView } from "../pose/formRuleEngine";
import { analyzePoseSet } from "../pose/poseSetAnalysis";
import type { PoseEstimate } from "../pose/PoseEngine";
import { segmentRepsAuto } from "../pose/repSegmenter";
import { selectTrainingWindow } from "../pose/trainingWindow";

interface ImportedLabels {
  exerciseId?: string;
  cameraView?: CameraView;
  labels?: Array<{ repIndex: number; startMs: number; extremeMs: number; endMs: number }>;
}

interface ImportedFixture {
  video: string;
  durationSec: number;
  poses: PoseEstimate[];
}

interface ReviewCapture {
  id: string;
  videoFile: File;
  videoUrl: string;
  fixture: ImportedFixture;
  labels: ImportedLabels | null;
}

interface Approval {
  expectedCount: string;
  candidateId: string;
  candidateCount: number;
  exerciseId: string;
  cameraView: CameraView;
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

interface DirectoryFileHandle {
  kind: "file";
  name: string;
  getFile(): Promise<File>;
}

interface DirectoryHandle {
  values(): AsyncIterableIterator<DirectoryFileHandle>;
}

const APPROVAL_KEY = "form-coach-capture-approvals/v1";
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

async function parseCaptureFiles(files: File[]): Promise<ReviewCapture[]> {
  const byName = new Map(files.map((file) => [file.name, file]));
  const fixtures = files.filter((file) => /\.json$/i.test(file.name) && !/\.labels\.json$/i.test(file.name));
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
      const labels = labelsFile ? JSON.parse(await labelsFile.text()) as ImportedLabels : null;
      captures.push({ id, videoFile, videoUrl: URL.createObjectURL(videoFile), fixture, labels });
    } catch {
      // A non-capture JSON in Downloads is not a review failure.
    }
  }
  return captures.sort((a, b) => b.id.localeCompare(a.id));
}

/**
 * Local-only evidence board. The athlete compares deterministic replays and
 * explicitly approves a ground-truth count; nothing is uploaded.
 */
export function CaptureApprovalPanel() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [captures, setCaptures] = useState<ReviewCapture[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [approvals, setApprovals] = useState<Record<string, Approval>>(loadApprovals);
  const [exerciseId, setExerciseId] = useState("");
  const [cameraView, setCameraView] = useState<CameraView>("oblique45");
  const [expectedCount, setExpectedCount] = useState("");

  const selected = captures.find((capture) => capture.id === selectedId) ?? null;
  const quality = selected ? qualityOf(selected.fixture.poses) : null;
  const candidates = useMemo(
    () => selected ? candidatesFor(selected, exerciseId, cameraView) : [],
    [selected, exerciseId, cameraView],
  );

  useEffect(() => () => captures.forEach((capture) => URL.revokeObjectURL(capture.videoUrl)), [captures]);

  const importFiles = async (files: File[]) => {
    setError(null);
    const loaded = await parseCaptureFiles(files);
    if (!loaded.length) {
      setError("没有找到完整采集包：每组需要同名的 .webm/.mp4/.mov 与 .json 文件。");
      return;
    }
    setCaptures((previous) => {
      previous.forEach((capture) => URL.revokeObjectURL(capture.videoUrl));
      return loaded;
    });
    const first = loaded[0];
    setSelectedId(first.id);
    setExerciseId(first.labels?.exerciseId ?? "");
    setCameraView(first.labels?.cameraView ?? "oblique45");
    const approval = approvals[first.id];
    setExpectedCount(approval?.expectedCount ?? "");
  };

  const importDirectory = async () => {
    const picker = (window as unknown as { showDirectoryPicker?: () => Promise<DirectoryHandle> }).showDirectoryPicker;
    if (!picker) {
      fileInputRef.current?.click();
      return;
    }
    try {
      const directory = await picker();
      const files: File[] = [];
      for await (const entry of directory.values()) {
        if (entry.kind === "file" && /field-capture-.*\.(json|webm|mp4|mov)$/i.test(entry.name)) {
          files.push(await entry.getFile());
        }
      }
      await importFiles(files);
    } catch (caught) {
      if ((caught as DOMException)?.name !== "AbortError") {
        setError(caught instanceof Error ? caught.message : String(caught));
      }
    }
  };

  const chooseCapture = (capture: ReviewCapture) => {
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
        approvedAt: new Date().toISOString(),
      },
    };
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
          <p style={styles.subtitle}>同一关键点序列的固定回放对比；审批结果只保存在这台设备。</p>
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
                  <label>动作<select value={exerciseId} onChange={(event) => setExerciseId(event.target.value)}>{EXERCISE_REGISTRY.exercises.filter((exercise) => EXERCISE_REGISTRY.canRunSpecializedAnalysis(exercise.id)).map((exercise) => <option key={exercise.id} value={exercise.id}>{exercise.nameZh}</option>)}</select></label>
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
                {approvals[selected.id] && <p style={styles.approved}>✓ 已批准：{approvals[selected.id].candidateId}；实际 {approvals[selected.id].expectedCount || "未填写"} 次</p>}
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
