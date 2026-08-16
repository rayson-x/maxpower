import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  defaultLensFacing,
  resolveMotionRuntimeCapability,
  resolveRecognitionCapability,
} from "../../src/mobile/exerciseRecognition";
import {
  buildLibrary,
  filterLibrary,
  countByRecognitionAvailability,
} from "../../src/mobile/libraryModel";
import { EXERCISE_REGISTRY } from "../../src/pose/exerciseRegistry";
import { recommendCapturePosition } from "../../src/pose/viewGating";
import { assessFraming, type FramingLandmark } from "../../src/mobile/frameGating";
import { assembleSetReport } from "../../src/mobile/setReport";
import { liveObservationLine, mapFinding, phaseLabel } from "../../src/mobile/findingsCopy";
import type { DecodedMotionPacket } from "../../src/motion/motionPacket";

test("Android 实时识别使用冻结的 YOLOX + RTMPose Halpe-26 多人候选管线", () => {
  const viewSource = fs.readFileSync(path.join(
    process.cwd(),
    "modules/pose-camera/android/src/main/java/expo/modules/posecamera/PoseCameraView.kt",
  ), "utf8");
  const pipelineSource = fs.readFileSync(path.join(
    process.cwd(),
    "modules/pose-camera/android/src/main/java/expo/modules/posecamera/RtmposePipeline.kt",
  ), "utf8");
  const gradle = fs.readFileSync(path.join(
    process.cwd(),
    "modules/pose-camera/android/build.gradle",
  ), "utf8");
  const bridgeSource = fs.readFileSync(path.join(
    process.cwd(),
    "modules/pose-camera/android/src/main/cpp/motion_bridge.cpp",
  ), "utf8");
  const equipmentAdapterSource = fs.readFileSync(path.join(
    process.cwd(),
    "modules/pose-camera/android/src/main/java/expo/modules/posecamera/VisualEquipmentFrameAdapter.kt",
  ), "utf8");
  assert.match(viewSource, /modelName: String = RtmposePipeline\.MODEL_NAME/);
  assert.match(viewSource, /MotionNative\.processObservations\(/);
  assert.match(viewSource, /visualEquipmentLumaFrame\(/);
  assert.match(viewSource, /visualLuma\s*=/);
  assert.doesNotMatch(viewSource, /BarbellAxisTracker/);
  assert.match(viewSource, /STRATEGY_KEEP_ONLY_LATEST/);
  assert.match(viewSource, /Size\(640, 480\)/);
  assert.match(pipelineSource, /yolox-nano-humanart-416x416\.onnx/);
  assert.match(pipelineSource, /rtmpose-m-halpe26-256x192\.onnx/);
  assert.match(pipelineSource, /HALPE_KEYPOINT_COUNT = 26/);
  assert.match(gradle, /onnxruntime-android:1\.24\.2/);
  assert.doesNotMatch(gradle, /opencv/);
  assert.match(bridgeSource, /motion_sdk_begin_visual_equipment_frame/);
  assert.match(bridgeSource, /motion_sdk_detect_barbell_axis/);
  assert.match(equipmentAdapterSource, /maximumDimension: Int = 480/);
});

test("iOS 实时与回放使用同一冻结 YOLOX + RTMPose Halpe-26 → Rust 管线", () => {
  const viewSource = fs.readFileSync(path.join(
    process.cwd(),
    "modules/pose-camera/ios/PoseCameraModule.swift",
  ), "utf8");
  const pipelineSource = fs.readFileSync(path.join(
    process.cwd(),
    "modules/pose-camera/ios/RtmposePipeline.mm",
  ), "utf8");
  const bridgeSource = fs.readFileSync(path.join(
    process.cwd(),
    "modules/pose-camera/ios/MotionBridge.mm",
  ), "utf8");
  const podspec = fs.readFileSync(path.join(
    process.cwd(),
    "modules/pose-camera/ios/PoseCamera.podspec",
  ), "utf8");
  assert.match(viewSource, /AVPlayerItemVideoOutput/);
  assert.match(viewSource, /processPixelBuffer\(/);
  assert.match(viewSource, /visualEquipmentLumaFrame\(/);
  assert.match(viewSource, /motionBridge\.processObservations\(/);
  assert.match(viewSource, /yolox-nano-humanart-416x416/);
  assert.match(viewSource, /maximumDimension: Int = 480/);
  assert.match(pipelineSource, /kHalpeKeypointCount = 26/);
  assert.match(bridgeSource, /motion_sdk_process_multi/);
  assert.match(bridgeSource, /motion_sdk_begin_visual_equipment_frame/);
  assert.match(bridgeSource, /motion_sdk_detect_barbell_axis/);
  assert.match(podspec, /onnxruntime-objc', '1\.24\.2'/);
});

test("识别能力：built-in 和 data profile 都能编码为 Android envelope", () => {
  const builtIn = resolveRecognitionCapability("lat_pulldown", "rear");
  assert.equal(builtIn.mode, "built_in");
  assert.equal(builtIn.canCount, true);
  assert.equal(JSON.parse(builtIn.nativeProfileJson).profileCode, 101);

  const data = resolveRecognitionCapability("bodyweight_squat", "left");
  const envelope = JSON.parse(data.nativeProfileJson) as {
    schemaVersion: string;
    mode: string;
    identity: string;
    abiArguments: number[];
    equipmentVision: string;
  };
  assert.equal(data.mode, "simulated_initializer");
  assert.equal(data.canRunRustRecognition, true);
  assert.equal(envelope.schemaVersion, "maxpower-native-recognition-profile/v1");
  assert.equal(envelope.mode, "data");
  assert.equal(envelope.identity, data.profileIdentity);
  assert.match(envelope.identity, /-halpe26$/);
  assert.equal(envelope.abiArguments.length, 24);

  const observed = resolveRecognitionCapability("machine_chest_press", "front");
  assert.equal(observed.mode, "observed");
  assert.match(observed.profileIdentity ?? "", /observed\/v1-halpe26$/);

  const barbellBench = JSON.parse(
    resolveRecognitionCapability("barbell_bench_press", "frontLeft45").nativeProfileJson,
  ) as { equipmentVision: string; identity: string; abiArguments: number[] };
  assert.equal(barbellBench.equipmentVision, "barbell_axis");
  assert.match(barbellBench.identity, /barbell-axis-primary-client-v1$/);
  assert.equal(barbellBench.abiArguments[5], 14);
  assert.equal(envelope.equipmentVision, "off");

  const dumbbellBench = JSON.parse(
    resolveRecognitionCapability("dumbbell_bench_press", "front").nativeProfileJson,
  ) as { equipmentVision: string };
  assert.equal(dumbbellBench.equipmentVision, "off");

  const unavailable = resolveRecognitionCapability("bodyweight_squat", "front");
  assert.equal(unavailable.mode, "none");
  assert.equal(unavailable.canCount, false);
});

test("杠铃坐姿推肩由动作契约开启杠轴，显式哑铃上下文不会误启", () => {
  const actionDefault = resolveRecognitionCapability(
    "seated_shoulder_press",
    "frontLeft45",
    "android",
  );
  const defaultEnvelope = JSON.parse(actionDefault.nativeProfileJson) as {
    equipmentVision: string;
  };
  assert.equal(actionDefault.profileIdentity, "seated_barbell_shoulder_press_local_front_left");
  assert.equal(defaultEnvelope.equipmentVision, "barbell_axis");

  const barbell = resolveRecognitionCapability(
    "seated_shoulder_press",
    "frontLeft45",
    "android",
    { selectedEquipment: "barbell" },
  );
  const barbellEnvelope = JSON.parse(barbell.nativeProfileJson) as {
    profileCode: number;
    equipmentVision: string;
  };
  assert.equal(barbell.mode, "built_in");
  assert.equal(barbell.profileIdentity, "seated_barbell_shoulder_press_local_front_left");
  assert.equal(barbellEnvelope.profileCode, 113);
  assert.equal(barbellEnvelope.equipmentVision, "barbell_axis");

  const dumbbell = resolveRecognitionCapability(
    "seated_shoulder_press",
    "frontLeft45",
    "android",
    { selectedEquipment: "dumbbell" },
  );
  const dumbbellEnvelope = JSON.parse(dumbbell.nativeProfileJson) as {
    equipmentVision: string;
  };
  assert.equal(dumbbell.profileIdentity, "seated_shoulder_press");
  assert.equal(dumbbellEnvelope.equipmentVision, "off");

  const webSource = fs.readFileSync(path.join(
    process.cwd(),
    "src/components/CameraPoseView.web.tsx",
  ), "utf8");
  assert.match(webSource, /estimateCapturedFrame\(/);
  assert.match(webSource, /readCapturedLumaFrame\(/);
  assert.match(webSource, /processCandidates\([\s\S]*candidates,[\s\S]*canonicalTimestampMs,[\s\S]*\[\],[\s\S]*visualEquipmentFrame,[\s\S]*\)/);
});

test("iOS 只在共享 Halpe-26 Rust packet bridge 下声明 rep count 与 phase", () => {
  const ios = resolveRecognitionCapability("lat_pulldown", "rear", "ios");
  assert.equal(ios.canRunRustRecognition, true);
  assert.equal(ios.canCount, true);
  assert.equal(ios.canEmitPhase, true);
  assert.equal(JSON.parse(ios.nativeProfileJson).profileCode, 101);
});

test("共享运行时 resolver 把平台 bridge 与 pose model 纳入 capability，不能只看动作 profile", () => {
  const android = resolveMotionRuntimeCapability({
    exerciseVariantId: "lat_pulldown",
    capturePosition: "rear",
    lensFacing: "back",
    poseModel: "rtmpose-m-halpe26",
    platform: "android",
  });
  assert.equal(android.repCounting, "available");

  const unsupportedModel = resolveMotionRuntimeCapability({
    exerciseVariantId: "lat_pulldown",
    capturePosition: "rear",
    lensFacing: "back",
    poseModel: "heavy",
    platform: "android",
  });
  assert.equal(unsupportedModel.repCounting, "unavailable");
  assert.equal(unsupportedModel.reasonCodes.includes("pose_model_unsupported"), true);

  const ios = resolveMotionRuntimeCapability({
    exerciseVariantId: "lat_pulldown",
    capturePosition: "rear",
    lensFacing: "back",
    poseModel: "rtmpose-m-halpe26",
    platform: "ios",
  });
  assert.equal(ios.localRecording, "available");
  assert.equal(ios.repCounting, "available");
  assert.equal(ios.reasonCodes.includes("validated_analysis_record_missing"), true);
});

test("识别能力：70 个动作在推荐机位都有可执行 Rust profile", () => {
  const counts = countByRecognitionAvailability();
  assert.deepEqual(counts, { available: 70, unavailable: 0 });
  for (const exercise of EXERCISE_REGISTRY.exercises) {
    const position = recommendCapturePosition(exercise.id)?.position ?? "front";
    const capability = resolveRecognitionCapability(exercise.id, position);
    assert.equal(capability.canRunRustRecognition, true, `${exercise.id}/${position}`);
  }
  assert.equal(
    resolveRecognitionCapability("cable_external_rotation", "frontLeft45").canCount,
    true,
  );
});

test("默认镜头：居家前置，力量后置", () => {
  assert.equal(defaultLensFacing("march_in_place"), "front");
  assert.equal(defaultLensFacing("lat_pulldown"), "back");
  assert.equal(defaultLensFacing("barbell_row"), "back");
});

test("动作库：分组覆盖 70 个动作，居家组独立成组", () => {
  const groups = buildLibrary();
  const total = groups.reduce((sum, group) => sum + group.rows.length, 0);
  assert.equal(total, 70);
  const home = groups.find((group) => group.id === "home");
  assert.equal(home?.rows.length, 7);
  // 每行都带机位推荐（viewGating 全覆盖）
  for (const group of groups) {
    for (const row of group.rows) {
      assert.ok(row.capturePositionLabel, `${row.exercise.id} 缺机位推荐`);
    }
  }
});

test("动作库：搜索与层级筛选", () => {
  const groups = buildLibrary();
  const searched = filterLibrary(groups, "下拉", "all");
  const ids = searched.flatMap((group) => group.rows.map((row) => row.exercise.id));
  assert.ok(ids.includes("lat_pulldown"));
  assert.ok(ids.includes("wide_grip_lat_pulldown"));

  const recognizedOnly = filterLibrary(groups, "", "available");
  assert.equal(
    recognizedOnly.reduce((sum, group) => sum + group.rows.length, 0),
    70,
  );
});

function landmark(x: number, y: number, visibility = 0.9): FramingLandmark {
  return { x, y, visibility };
}

test("入框校验：全身可见 → 合格", () => {
  const landmarks = Array.from({ length: 33 }, (_, i) =>
    landmark(0.3 + (i % 3) * 0.2, 0.05 + i * 0.028),
  );
  const result = assessFraming(landmarks);
  assert.equal(result.ok, true);
  assert.equal(result.hint, null);
});

test("入框校验：脚部缺失 → 提示后退或抬高", () => {
  const landmarks = Array.from({ length: 33 }, (_, i) =>
    landmark(0.3 + (i % 3) * 0.2, 0.05 + i * 0.02, i >= 27 ? 0.1 : 0.9),
  );
  const result = assessFraming(landmarks);
  assert.equal(result.ok, false);
  assert.equal(result.hint, "raise_camera");
});

test("入框校验：大面积丢失 → 低置信提示", () => {
  const landmarks = Array.from({ length: 33 }, () => landmark(0.5, 0.5, 0.2));
  const result = assessFraming(landmarks);
  assert.equal(result.ok, false);
  assert.equal(result.hint, "low_confidence");
});

function fakePacket(options: {
  timestampMs: number;
  epoch?: number;
  reps?: Array<{
    repId: number;
    revision?: number;
    disposition?: "confirmed" | "needs_review" | "rejected";
    startMs: number;
    endMs: number;
    findings?: Array<"primary_range_below_expectation" | "cycle_faster_than_expected">;
  }>;
  wristY?: number;
}): DecodedMotionPacket {
  const canonical = Array.from({ length: 33 }, (_, i) => ({
    x: 0.5,
    y: i === 16 ? options.wristY ?? 0.5 : 0.5,
    z: 0,
    observationScore: 0.9,
    canonicalConfidence: 0.9,
    uncertainty: null,
    source: "measured" as const,
    reason: null,
    renderable: true,
  }));
  return {
    subjectEpoch: BigInt(options.epoch ?? 1),
    sourceTimestampMs: BigInt(options.timestampMs),
    canonical,
    completedReps: (options.reps ?? []).map((rep) => ({
      repId: BigInt(rep.repId),
      startTimestampMs: BigInt(rep.startMs),
      endTimestampMs: BigInt(rep.endMs),
      revision: rep.revision ?? 0,
      disposition: rep.disposition ?? "confirmed",
      observationFindings: rep.findings ?? [],
    })),
  } as unknown as DecodedMotionPacket;
}

test("报告组装：确认计数、revision 去重、幅度归一、便签文案", () => {
  const packets = [
    fakePacket({ timestampMs: 0, wristY: 0.8 }),
    fakePacket({ timestampMs: 1000, wristY: 0.2, reps: [{ repId: 1, startMs: 0, endMs: 1000 }] }),
    fakePacket({ timestampMs: 2000, wristY: 0.8 }),
    fakePacket({
      timestampMs: 3000,
      wristY: 0.35, // 第二次行程更短 → 幅度相对不足
      reps: [{ repId: 2, startMs: 2000, endMs: 3000, findings: ["primary_range_below_expectation"] }],
    }),
    // rep 2 的 revision 更新：findings 随最高 revision 保留
    fakePacket({
      timestampMs: 3100,
      wristY: 0.35,
      reps: [{ repId: 2, revision: 1, startMs: 2000, endMs: 3000, findings: ["primary_range_below_expectation"] }],
    }),
  ];
  const report = assembleSetReport(packets, {
    processedFrames: 100,
    validFrames: 96,
    processedFps: 24,
  }, "zh");
  assert.equal(report.confirmedCount, 2);
  assert.equal(report.reps.length, 2);
  assert.equal(report.durationMs, 3100);
  assert.equal(report.validFrames, 96);
  // rep1 行程 0.6、rep2 行程 0.45 → 中位 0.525 → rep2 比例 ≈0.86? 验证相对关系即可
  const [rep1, rep2] = report.reps;
  assert.ok(rep1.amplitudeRatio !== null && rep2.amplitudeRatio !== null);
  assert.ok(rep1.amplitudeRatio! > rep2.amplitudeRatio!);
  assert.match(report.coachNote, /2 次全部确认/);
  assert.match(report.coachNote, /幅度相对本组不足/);
});

test("报告组装：零确认的便签给机位建议", () => {
  const report = assembleSetReport([fakePacket({ timestampMs: 0 })], {
    processedFrames: 10,
    validFrames: 9,
    processedFps: 15,
  }, "zh");
  assert.equal(report.confirmedCount, 0);
  assert.match(report.coachNote, /机位/);
});

test("实时便签一行文案与相位标签", () => {
  assert.equal(liveObservationLine([], "zh"), "节奏与轨迹稳定 — 保持");
  assert.equal(
    liveObservationLine(["primary_range_below_expectation"], "zh"),
    "动作幅度相对本组不足",
  );
  assert.equal(phaseLabel("effort", "zh"), "发力");
  assert.equal(phaseLabel("effort"), "Drive", "英文为权威源，缺省 locale 走英文");
});

test("器械融合 finding 在共享客户端上都有证据边界文案", () => {
  assert.deepEqual(
    mapFinding("equipment_primary_boundary", "zh"),
    {
      finding: "equipment_primary_boundary",
      level: "info",
      title: "本次阶段边界来自器械轨迹",
      detail: "系统根据器械换向判断本次动作边界，身体姿态仍作为独立观察保留",
    },
  );
  assert.equal(mapFinding("pose_equipment_turnaround_conflict", "zh").level, "warn");
  assert.match(mapFinding("pose_equipment_turnaround_conflict", "zh").detail, /不能直接选择一方作为真值/);
  assert.equal(mapFinding("equipment_path_coverage_low", "en").title, "Equipment path coverage is low");
});
