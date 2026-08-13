import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = process.cwd();

function source(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

test("Android and iOS submit Halpe-26 multi-candidate pose and equipment through the same Rust frame", () => {
  const header = source("modules/pose-camera/common/motion_sdk.h");
  const androidBridge = source("modules/pose-camera/android/src/main/cpp/motion_bridge.cpp");
  const androidAdapter = source(
    "modules/pose-camera/android/src/main/java/expo/modules/posecamera/MotionNative.kt",
  );
  const androidPipeline = source(
    "modules/pose-camera/android/src/main/java/expo/modules/posecamera/RtmposePipeline.kt",
  );
  const iosBridge = source("modules/pose-camera/ios/MotionBridge.mm");
  const iosPipeline = source("modules/pose-camera/ios/RtmposePipeline.mm");

  for (const symbol of [
    "motion_sdk_begin_multi",
    "motion_sdk_begin_candidate",
    "motion_sdk_commit_candidate",
    "motion_sdk_add_equipment_observation",
    "motion_sdk_process_multi",
  ]) {
    assert.match(header, new RegExp(`${symbol}\\(`));
    assert.match(androidBridge, new RegExp(`${symbol}\\(`));
    assert.match(iosBridge, new RegExp(`${symbol}\\(`));
  }
  assert.match(androidAdapter, /fun processObservations\([\s\S]*equipmentIds: LongArray/);
  assert.match(androidPipeline, /HALPE_KEYPOINT_COUNT = 26/);
  assert.match(iosPipeline, /kHalpeKeypointCount = 26/);
  assert.match(androidPipeline, /yolox-nano-humanart-416x416\.onnx/);
  assert.match(androidPipeline, /rtmpose-m-halpe26-256x192\.onnx/);
  assert.match(iosPipeline, /simcc_x/);
  assert.match(iosPipeline, /simcc_y/);
});

test("native camera hosts return the Rust packet without owning QLT1 semantics", () => {
  const androidView = source(
    "modules/pose-camera/android/src/main/java/expo/modules/posecamera/PoseCameraView.kt",
  );
  const iosView = source("modules/pose-camera/ios/PoseCameraModule.swift");
  const projection = source("modules/pose-camera/src/qualityProjection.ts");

  assert.match(androidView, /MotionNative\.processObservations\([\s\S]*packetBase64/);
  assert.match(iosView, /motionBridge\.processObservations\([\s\S]*packetBase64/);
  assert.doesNotMatch(androidView, /QLT1|qualityProjection/);
  assert.doesNotMatch(iosView, /QLT1|qualityProjection/);
  assert.match(projection, /Projects the Rust-owned QLT1 envelope without interpreting/);
});

test("Apple bridge parity rebuilds client Rust artifacts and excludes generated frameworks from sources", () => {
  const script = source("tools/motion-sdk/run-ios-real-halpe26-bridge-parity.sh");
  const harness = source("tools/motion-sdk/ios/RealHalpe26BridgeParity.mm");
  const podspec = source("modules/pose-camera/ios/PoseCamera.podspec");

  assert.match(script, /build-native\.sh" apple/);
  assert.match(script, /ios-simulator-universal\/libmaxpower_motion_sdk\.a/);
  assert.match(harness, /visualLuma:nil/);
  assert.match(harness, /HasRustQualityEnvelope/);
  assert.doesNotMatch(harness, /offset \+ 8 \+ payloadLength == packet\.length/);
  assert.match(podspec, /s\.vendored_frameworks = 'Frameworks\/MotionSdk\.xcframework'/);
  assert.match(podspec, /s\.exclude_files = 'Frameworks\/\*\*\/\*'/);
});

test("Android and iOS project every Rust visual barbell source including fused", () => {
  const androidBridge = source("modules/pose-camera/android/src/main/cpp/motion_bridge.cpp");
  const androidAdapter = source(
    "modules/pose-camera/android/src/main/java/expo/modules/posecamera/MotionNative.kt",
  );
  const iosBridge = source("modules/pose-camera/ios/MotionBridge.mm");

  assert.match(androidBridge, /if \(source > 3\) return nullptr/);
  assert.match(androidAdapter, /3 -> "fused"/);
  assert.match(iosBridge, /source == 3 \? @"fused"/);
});
