import { gunzipSync } from "node:zlib";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { mkdir } from "node:fs/promises";

import {
  instantiateRustMotionWasm,
  RustCanonicalWasmSession,
  type RustSealedRep,
} from "../../src/motion/rustCanonicalWasm.js";
import { resolveSimulatedRecognitionProfile } from "../../src/motion/simulatedRecognitionProfile.js";
import { resolveEquipmentRecognitionPolicy } from "../../src/motion/equipmentRecognitionPolicy.js";
import type { CapturePosition } from "../../src/pose/viewGating.js";

interface SourceEntry {
  captureId: string;
  video: string;
  durationMs: number;
  exerciseId: string;
  capturePosition: CapturePosition;
  selectedEquipment: "barbell" | "dumbbell" | "none";
  assignmentSource: "visual_provisional";
  groundTruthStatus: "unlabeled";
  notes?: string;
}

interface SourceManifest {
  sources: SourceEntry[];
}

interface Landmark {
  x: number;
  y: number;
  z: number | null;
  visibility: number;
}

interface Sidecar {
  poseSchema: "halpe26";
  source: { widthPx: number; heightPx: number; durationMs: number };
  inference: { pipeline: string; sampleFps: number };
  summary: {
    sampledFrameCount: number;
    poseFrameCount: number;
    detectorObservedFrameRatio: number;
    meanPoseScore: number;
  };
  frames: Array<{ timestampMs: number; landmarks: Landmark[] }>;
}

interface Segment {
  startMs: number;
  peakMs: number;
  endMs: number;
  disposition: RustSealedRep["disposition"];
  evidenceReason: RustSealedRep["evidenceReason"];
}

const LOWER_BODY_INDICES = [11, 12, 13, 14, 15, 16] as const;

function option(argv: readonly string[], name: string): string {
  const index = argv.indexOf(name);
  const value = index >= 0 ? argv[index + 1] : undefined;
  if (!value) throw new Error(`missing ${name}`);
  return value;
}

function finite(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function percent(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const manifestPath = resolve(option(argv, "--manifest"));
  const sidecarRoot = resolve(option(argv, "--sidecars"));
  const wasmPath = resolve(option(argv, "--wasm"));
  const outputPath = resolve(option(argv, "--output"));
  const markdownPath = resolve(option(argv, "--markdown-output"));
  const [manifestBytes, wasmBytes] = await Promise.all([
    readFile(manifestPath),
    readFile(wasmPath),
  ]);
  const manifest = JSON.parse(manifestBytes.toString("utf8")) as SourceManifest;
  const rows = [];

  for (const source of manifest.sources) {
    const compressed = await readFile(resolve(sidecarRoot, `${source.captureId}.halpe26.json.gz`));
    const sidecar = JSON.parse(gunzipSync(compressed).toString("utf8")) as Sidecar;
    const equipmentPolicy = resolveEquipmentRecognitionPolicy({
      exerciseId: source.exerciseId,
      selectedEquipment: source.selectedEquipment,
    });
    const profile = resolveSimulatedRecognitionProfile({
      exerciseId: source.exerciseId,
      capturePosition: source.capturePosition,
      trainingSide: "bilateral",
      variation: "",
    });
    const poseFrames = sidecar.frames.filter((frame) => frame.landmarks.length === 26);
    const lowerBodyObservedRatio = sidecar.frames.length === 0 ? 0 : (
      sidecar.frames.filter((frame) => LOWER_BODY_INDICES.every(
        (index) => (frame.landmarks[index]?.visibility ?? 0) >= 0.3,
      )).length / sidecar.frames.length
    );

    if (!profile) {
      rows.push({
        captureId: source.captureId,
        video: source.video,
        provisionalExerciseId: source.exerciseId,
        capturePosition: source.capturePosition,
        assignmentSource: source.assignmentSource,
        groundTruthStatus: source.groundTruthStatus,
        profileStatus: "unavailable_for_exact_view",
        profileIdentity: null,
        confirmedRepCount: null,
        needsReviewRepCount: null,
        rejectedRepCount: null,
        segments: [],
        pose: {
          pipeline: sidecar.inference.pipeline,
          sampleFps: sidecar.inference.sampleFps,
          sampledFrameCount: sidecar.summary.sampledFrameCount,
          poseFrameRatio: sidecar.frames.length ? poseFrames.length / sidecar.frames.length : 0,
          lowerBodyObservedRatio,
          detectorObservedFrameRatio: sidecar.summary.detectorObservedFrameRatio,
          meanPoseScore: sidecar.summary.meanPoseScore,
        },
        equipment: {
          policyEnabled: equipmentPolicy.enabled,
          requestedKinds: equipmentPolicy.kinds,
          detectorAvailableInThisRun: false,
          observationCount: 0,
          role: equipmentPolicy.role,
        },
        onePass: true,
        usesTruthAtInference: false,
        reason: "No exact simulated initializer exists for the selected action and camera view.",
        notes: source.notes ?? "",
      });
      continue;
    }

    const wasm = await instantiateRustMotionWasm(wasmBytes);
    const session = new RustCanonicalWasmSession({
      sequenceId: `new-video-one-pass:${source.captureId}`,
      schema: "halpe26",
      image: {
        widthPx: sidecar.source.widthPx,
        heightPx: sidecar.source.heightPx,
        mirrored: false,
        rotationDegrees: 0,
      },
      stabilization: "fusion",
      setLifecycleMode: "preview",
    }, wasm);
    session.installExerciseProfileData(profile);
    session.beginSet();
    const outcomes = new Map<string, RustSealedRep>();
    const started = performance.now();
    for (const frame of sidecar.frames) {
      session.process({
        timestampMs: frame.timestampMs,
        landmarks: frame.landmarks.length === 26
          ? frame.landmarks.map((landmark) => ({
            x: finite(landmark.x),
            y: finite(landmark.y),
            z: finite(landmark.z),
            visibility: finite(landmark.visibility),
          }))
          : Array.from({ length: 26 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 })),
        worldLandmarks: [],
      });
      for (const rep of session.lastCompletedReps) outcomes.set(rep.repId.toString(), rep);
    }
    session.finishSet();
    for (const rep of session.lastCompletedReps) outcomes.set(rep.repId.toString(), rep);
    const runtimeMs = performance.now() - started;
    const sealed = [...outcomes.values()];
    const segments: Segment[] = sealed.map((rep) => ({
      startMs: Number(rep.startTimestampMs),
      peakMs: Number(rep.peakTimestampMs),
      endMs: Number(rep.endTimestampMs),
      disposition: rep.disposition,
      evidenceReason: rep.evidenceReason,
    }));
    rows.push({
      captureId: source.captureId,
      video: source.video,
      provisionalExerciseId: source.exerciseId,
      capturePosition: source.capturePosition,
      assignmentSource: source.assignmentSource,
      groundTruthStatus: source.groundTruthStatus,
      profileStatus: "simulated_initializer_only",
      profileIdentity: profile.identity,
      confirmedRepCount: segments.filter((segment) => segment.disposition === "confirmed").length,
      needsReviewRepCount: segments.filter((segment) => segment.disposition === "needs_review").length,
      rejectedRepCount: segments.filter((segment) => segment.disposition === "rejected").length,
      segments,
      pose: {
        pipeline: sidecar.inference.pipeline,
        sampleFps: sidecar.inference.sampleFps,
        sampledFrameCount: sidecar.summary.sampledFrameCount,
        poseFrameRatio: sidecar.frames.length ? poseFrames.length / sidecar.frames.length : 0,
        lowerBodyObservedRatio,
        detectorObservedFrameRatio: sidecar.summary.detectorObservedFrameRatio,
        meanPoseScore: sidecar.summary.meanPoseScore,
      },
      equipment: {
        policyEnabled: equipmentPolicy.enabled,
        requestedKinds: equipmentPolicy.kinds,
        detectorAvailableInThisRun: false,
        observationCount: 0,
        role: equipmentPolicy.role,
      },
      runtime: {
        chronologicalFrameCount: sidecar.frames.length,
        rustRuntimeMs: Number(runtimeMs.toFixed(3)),
        rustFramesPerSecond: runtimeMs > 0 ? Number((sidecar.frames.length / runtimeMs * 1000).toFixed(3)) : null,
      },
      onePass: true,
      usesTruthAtInference: false,
      reason: null,
      notes: source.notes ?? "",
    });
    session.close();
  }

  const report = {
    schemaVersion: "maxpower-new-video-one-pass-recognition/v1",
    generatedAt: new Date().toISOString(),
    purpose: "Unlabeled lower-body capture feasibility and candidate-rep audit",
    protocol: {
      chronologicalPassesPerVideo: 1,
      truthAvailableAtInference: false,
      expectedRepCountAvailableAtInference: false,
      exerciseIdentitySource: "visual_provisional_user-intended-action-routing",
      equipmentDetectorAvailable: false,
      accuracyClaimAllowed: false,
      productionPromotion: false,
    },
    summary: {
      sourceCount: rows.length,
      exactViewProfileAvailableCount: rows.filter((row) => row.profileStatus !== "unavailable_for_exact_view").length,
      exactViewProfileUnavailableCount: rows.filter((row) => row.profileStatus === "unavailable_for_exact_view").length,
      confirmedRepCandidateCount: rows.reduce((sum, row) => sum + (row.confirmedRepCount ?? 0), 0),
      needsReviewRepCandidateCount: rows.reduce((sum, row) => sum + (row.needsReviewRepCount ?? 0), 0),
      accuracy: null,
    },
    rows,
    limitations: [
      "The videos have no rep annotations, so candidate counts cannot be called correct or incorrect.",
      "The available lower-body profile is a broad simulated initializer, not a profile learned from labeled lower-body videos.",
      "This run contains person detection plus pose only; equipment policy is reported but no trained equipment detector produced observations.",
    ],
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await mkdir(dirname(markdownPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(markdownPath, markdown(report));
  process.stdout.write(`${JSON.stringify({ outputPath, markdownPath, summary: report.summary }, null, 2)}\n`);
}

function markdown(report: {
  summary: Record<string, unknown>;
  rows: Array<Record<string, any>>;
}): string {
  const lines = [
    "# new-video 下肢动作一次顺序识别",
    "",
    "这些视频尚未标注，因此本页只报告骨架可观测性和候选 rep，不能报告准确率。每条视频只按时间顺序通过一次 Rust profile。",
    "",
    "| 视频 | 暂定动作 / 机位 | 精确 profile | 下肢六点全可见 | 候选 confirmed / review | 器械辅助 |",
    "|---|---|---|---:|---:|---|",
  ];
  for (const row of report.rows) {
    lines.push(
      `| \`${String(row.captureId).slice(0, 8)}\` | \`${row.provisionalExerciseId}\` / \`${row.capturePosition}\` | ${row.profileStatus === "unavailable_for_exact_view" ? "无" : "模拟初始化"} | ${percent(row.pose.lowerBodyObservedRatio)} | ${row.confirmedRepCount ?? "—"} / ${row.needsReviewRepCount ?? "—"} | ${row.equipment.policyEnabled ? "已请求但检测器未接入" : "关闭"} |`,
    );
  }
  lines.push(
    "",
    "## 结论边界",
    "",
    "- `confirmed` 只是模拟初始化 profile 的候选，不是真值，也不是动作质量结论。",
    "- `front` 机位没有对应的下肢初始化 profile 时直接标为不可运行，没有借用其他机位 profile。",
    "- 要得到准确率，下一步只需标每个 rep 的起止范围；顶点可以由轨迹先提议、再由人审核。",
    "- 本轮没有训练过的杠铃/哑铃检测器，所以即使动作策略请求器械辅助，也没有把虚假的器械观测送进 Rust。",
    "",
  );
  return lines.join("\n");
}

void main();
